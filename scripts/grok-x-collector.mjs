import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { collectRecentYfspMovies } from "./yfsp-recent.mjs";
import { collectMacCalendarEvents } from "./calendar-collector.mjs";

export const GROK_MODEL = "grok-4.5";
export const DEFAULT_COLLECTOR_PORT = 8788;
export const GROK_TIMEOUT_MS = 40_000;
export const HN_SUMMARY_TIMEOUT_MS = 35_000;
export const MOVIE_TRANSLATION_TIMEOUT_MS = 20_000;

const MAX_OUTPUT_BYTES = 1_000_000;
const DISALLOWED_LOCAL_TOOLS = [
  "read_file",
  "write",
  "search_replace",
  "run_terminal_command",
  "get_command_or_subagent_output",
  "list_dir",
  "todo_write",
].join(",");

export const GROK_PROMPT =
  "Search X for the top 3 AI news stories trending right now. For each, return headline, one-sentence summary, and public X link. Skip ads and duplicates. Return JSON only.";
export const HN_SUMMARY_PROMPT =
  "Summarize each supplied Hacker News article from its full article text in one concise factual sentence. Do not summarize the title or ranking metadata. Do not search, rerank, or add new information. Return JSON only.";
export const MOVIE_TRANSLATION_PROMPT =
  "Translate the supplied movie title, genres, and plot summary into natural concise English. Preserve names and facts. Do not search or add information. Return JSON only.";

function cleanText(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";
}

function stableHash(value) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeXUrl(value) {
  let url;
  try {
    url = new URL(cleanText(value));
  } catch {
    return "";
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "x.com") {
    return "";
  }
  if (
    !/^\/(?:i\/trending\/\d+|[^/]+\/status\/\d+)\/?$/i.test(url.pathname)
  ) {
    return "";
  }

  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function normalizedHeadline(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unwrapPayload(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (
      value.length > 0 &&
      value.every(
        (item) =>
          item &&
          typeof item === "object" &&
          (typeof item.headline === "string" ||
            ((typeof item.id === "string" ||
              typeof item.id === "number") &&
              (typeof item.summary === "string" ||
                typeof item.description === "string"))),
      )
    ) {
      return { items: value };
    }
    for (const item of value) {
      const unwrapped = unwrapPayload(item, depth + 1);
      if (unwrapped) return unwrapped;
    }
    return undefined;
  }
  if (typeof value === "string") {
    try {
      return unwrapPayload(JSON.parse(value), depth + 1);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "object") return undefined;
  if (Array.isArray(value.items)) return value;

  for (const key of [
    "structured_output",
    "structuredOutput",
    "result",
    "output",
    "response",
    "content",
    "message",
  ]) {
    if (key in value) {
      const unwrapped = unwrapPayload(value[key], depth + 1);
      if (unwrapped) return unwrapped;
    }
  }
  return undefined;
}

function jsonObjects(value) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

export function parseGrokCliOutput(stdout) {
  // ANSI color escapes are control characters by definition.
  // eslint-disable-next-line no-control-regex
  const ansiColor = new RegExp("\\u001b\\[[0-9;]*m", "g");
  const cleaned = String(stdout)
    .replace(ansiColor, "")
    .trim();
  const fenced = [
    ...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi),
  ].map((match) => match[1].trim());
  const firstArray = cleaned.indexOf("[");
  const lastArray = cleaned.lastIndexOf("]");
  const arrayCandidate =
    firstArray >= 0 && lastArray > firstArray
      ? cleaned.slice(firstArray, lastArray + 1)
      : "";
  const candidates = [
    cleaned,
    ...fenced,
    arrayCandidate,
    ...jsonObjects(cleaned).reverse(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const payload = unwrapPayload(JSON.parse(candidate));
      if (payload) return payload;
    } catch {
      // Try the next complete JSON object from mixed CLI output.
    }
  }
  throw new Error("Grok returned no usable structured JSON");
}

export function validateGrokPayload(payload, collectedAt = new Date()) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
    throw new Error("Grok payload did not contain an items array");
  }

  const seenUrls = new Set();
  const seenHeadlines = new Set();
  const items = [];
  const timestamp = collectedAt.toISOString();
  const advertisement =
    /\b(sponsored|advertisement|promo code|limited[- ]time offer)\b/i;

  for (const raw of payload.items) {
    if (!raw || typeof raw !== "object") continue;
    const headline = cleanText(raw.headline);
    const summary = cleanText(raw.summary);
    const destinationUrl = normalizeXUrl(raw.url ?? raw.link);
    const headlineKey = normalizedHeadline(headline);

    if (
      headline.length < 12 ||
      headline.length > 140 ||
      summary.length < 25 ||
      summary.length > 300 ||
      advertisement.test(`${headline} ${summary}`) ||
      !destinationUrl ||
      seenUrls.has(destinationUrl) ||
      seenHeadlines.has(headlineKey)
    ) {
      continue;
    }

    seenUrls.add(destinationUrl);
    seenHeadlines.add(headlineKey);
    items.push({
      id: `grok-x-${stableHash(destinationUrl)}`,
      title: headline,
      summary,
      source: "X Explore",
      age: "Now",
      publishedAt: timestamp,
      contentHash: stableHash(
        `${headline}:${summary}:${destinationUrl}`,
      ),
      destinationUrl,
      signal: "Trending now",
    });
  }

  if (items.length !== 3) {
    throw new Error("Grok must return exactly 3 distinct valid stories");
  }
  return { items };
}

function minimalGrokEnvironment(environment) {
  const keys = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "GROK_API_KEY",
    "XAI_API_KEY",
  ];
  return Object.fromEntries(
    keys
      .filter((key) => environment[key])
      .map((key) => [key, environment[key]]),
  );
}

function executeGrok(executable, args, options) {
  const {
    timeoutMs = GROK_TIMEOUT_MS,
    ...execOptions
  } = options;
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        ...execOptions,
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout });
      },
    );
  });
}

export function grokArguments() {
  return [
    "--model",
    GROK_MODEL,
    "--no-memory",
    "--no-plan",
    "--no-subagents",
    "--max-turns",
    "6",
    "--permission-mode",
    "dontAsk",
    "--disallowed-tools",
    DISALLOWED_LOCAL_TOOLS,
    "--output-format",
    "plain",
    "--verbatim",
    "--single",
    GROK_PROMPT,
  ];
}

export function hackerNewsSummaryArguments(stories) {
  return [
    "--model",
    GROK_MODEL,
    "--no-memory",
    "--no-plan",
    "--no-subagents",
    "--max-turns",
    "1",
    "--permission-mode",
    "dontAsk",
    "--disallowed-tools",
    DISALLOWED_LOCAL_TOOLS,
    "--disable-web-search",
    "--output-format",
    "plain",
    "--verbatim",
    "--single",
    `${HN_SUMMARY_PROMPT}\nUse each supplied id exactly once and return [{"id":"...","summary":"..."}] in the same order.\n\nStories:\n${JSON.stringify(stories)}`,
  ];
}

export function movieTranslationArguments(movies) {
  return [
    "--model",
    GROK_MODEL,
    "--no-memory",
    "--no-plan",
    "--no-subagents",
    "--max-turns",
    "1",
    "--permission-mode",
    "dontAsk",
    "--disallowed-tools",
    DISALLOWED_LOCAL_TOOLS,
    "--disable-web-search",
    "--output-format",
    "plain",
    "--verbatim",
    "--single",
    `${MOVIE_TRANSLATION_PROMPT}\nUse each supplied id exactly once and return [{"id":"...","title":"...","genre":"...","description":"..."}] in the same order.\n\nMovies:\n${JSON.stringify(movies)}`,
  ];
}

export async function collectTrendingAi({
  execute = executeGrok,
  environment = process.env,
  now = new Date(),
} = {}) {
  const executable = environment.GROK_CLI_PATH?.trim() || "grok";
  const { stdout } = await execute(executable, grokArguments(), {
    cwd: tmpdir(),
    env: minimalGrokEnvironment(environment),
  });
  return validateGrokPayload(parseGrokCliOutput(stdout), now);
}

function validateHackerNewsSummaryInput(stories) {
  if (!Array.isArray(stories) || stories.length !== 3) {
    throw new Error("Exactly 3 Hacker News stories are required");
  }
  return stories.map((story) => {
    if (!story || typeof story !== "object") {
      throw new Error("Hacker News story input was invalid");
    }
    const id = cleanText(story.id);
    const title = cleanText(story.title);
    const url = cleanText(story.url);
    const content = cleanText(story.content);
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("Hacker News story URL was invalid");
    }
    if (
      !/^\d+$/.test(id) ||
      title.length < 5 ||
      title.length > 200 ||
      content.length < 300 ||
      content.length > 14_000 ||
      !["http:", "https:"].includes(parsedUrl.protocol)
    ) {
      throw new Error("Hacker News story input was invalid");
    }
    return {
      id,
      title,
      url: parsedUrl.toString(),
      content,
    };
  });
}

export function validateHackerNewsSummaries(payload, stories) {
  const expected = validateHackerNewsSummaryInput(stories);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
    throw new Error("Grok summary payload did not contain an items array");
  }
  if (payload.items.length !== expected.length) {
    throw new Error("Grok must return exactly 3 Hacker News summaries");
  }

  const summaries = new Map();
  for (const item of payload.items) {
    const id =
      typeof item?.id === "number"
        ? String(item.id)
        : cleanText(item?.id);
    const summary = cleanText(item?.summary);
    if (
      !expected.some((story) => story.id === id) ||
      summaries.has(id) ||
      summary.length < 20 ||
      summary.length > 320 ||
      /https?:\/\//i.test(summary)
    ) {
      throw new Error("Grok returned an invalid Hacker News summary");
    }
    summaries.set(id, summary);
  }
  return {
    items: expected.map(({ id }) => ({
      id,
      summary: summaries.get(id),
    })),
  };
}

export async function summarizeHackerNewsStories({
  stories,
  execute = executeGrok,
  environment = process.env,
} = {}) {
  const safeStories = validateHackerNewsSummaryInput(stories);
  const executable = environment.GROK_CLI_PATH?.trim() || "grok";
  const { stdout } = await execute(
    executable,
    hackerNewsSummaryArguments(safeStories),
    {
      cwd: tmpdir(),
      env: minimalGrokEnvironment(environment),
      timeoutMs: HN_SUMMARY_TIMEOUT_MS,
    },
  );
  return validateHackerNewsSummaries(parseGrokCliOutput(stdout), safeStories);
}

function validateMovieTranslationInput(movies) {
  if (!Array.isArray(movies) || movies.length !== 3) {
    throw new Error("Exactly 3 movies are required");
  }
  return movies.map((movie) => {
    if (!movie || typeof movie !== "object") {
      throw new Error("Movie translation input was invalid");
    }
    const id = cleanText(movie.id);
    const title = cleanText(movie.title);
    const genre = cleanText(movie.genre);
    const description = cleanText(movie.description);
    if (
      !id ||
      title.length < 1 ||
      title.length > 160 ||
      genre.length < 2 ||
      genre.length > 120 ||
      description.length < 20 ||
      description.length > 500
    ) {
      throw new Error("Movie translation input was invalid");
    }
    return { id, title, genre, description };
  });
}

function translatedMonogram(title) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function validateMovieTranslations(payload, movies) {
  const expected = validateMovieTranslationInput(movies);
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
    throw new Error("Grok movie translation did not contain an items array");
  }
  if (payload.items.length !== expected.length) {
    throw new Error("Grok must return exactly 3 movie translations");
  }

  const translated = new Map();
  const cjkText = /[\u3400-\u9fff\uf900-\ufaff]/u;
  for (const item of payload.items) {
    const id =
      typeof item?.id === "number"
        ? String(item.id)
        : cleanText(item?.id);
    const title = cleanText(item?.title);
    const genre = cleanText(item?.genre);
    const description = cleanText(item?.description);
    if (
      !expected.some((movie) => movie.id === id) ||
      translated.has(id) ||
      title.length < 1 ||
      title.length > 140 ||
      genre.length < 2 ||
      genre.length > 100 ||
      description.length < 20 ||
      description.length > 360 ||
      cjkText.test(`${title} ${genre} ${description}`) ||
      /https?:\/\//i.test(`${title} ${genre} ${description}`)
    ) {
      throw new Error("Grok returned an invalid movie translation");
    }
    translated.set(id, { title, genre, description });
  }

  return {
    items: movies.map((movie) => {
      const english = translated.get(movie.id);
      if (!english) throw new Error("Grok omitted a movie translation");
      return {
        ...movie,
        ...english,
        posterAlt: `${english.title} poster`,
        monogram: translatedMonogram(english.title),
      };
    }),
  };
}

export async function translateMoviesToEnglish({
  movies,
  execute = executeGrok,
  environment = process.env,
} = {}) {
  const safeMovies = validateMovieTranslationInput(movies);
  const executable = environment.GROK_CLI_PATH?.trim() || "grok";
  const { stdout } = await execute(
    executable,
    movieTranslationArguments(safeMovies),
    {
      cwd: tmpdir(),
      env: minimalGrokEnvironment(environment),
      timeoutMs: MOVIE_TRANSLATION_TIMEOUT_MS,
    },
  );
  return validateMovieTranslations(parseGrokCliOutput(stdout), movies);
}

export function createEnglishMovieCollector({
  collect = collectRecentYfspMovies,
  translate = translateMoviesToEnglish,
} = {}) {
  let cachedKey = "";
  let cachedResult;
  let pendingKey = "";
  let pending;

  return async function collectEnglishMovies() {
    const result = await collect();
    const key = JSON.stringify(
      result.items.map(({ id, title, genre, description }) => ({
        id,
        title,
        genre,
        description,
      })),
    );
    if (key === cachedKey && cachedResult) return cachedResult;
    if (key === pendingKey && pending) return pending;

    pendingKey = key;
    pending = translate({ movies: result.items })
      .then((translated) => {
        cachedKey = key;
        cachedResult = translated;
        return translated;
      })
      .finally(() => {
        pendingKey = "";
        pending = undefined;
      });
    return pending;
  };
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

export function createCollectorServer({
  token,
  collector = collectTrendingAi,
  summarizer = summarizeHackerNewsStories,
  movieCollector = createEnglishMovieCollector(),
  calendarCollector = collectMacCalendarEvents,
} = {}) {
  if (!token) throw new Error("GROK_X_COLLECTOR_TOKEN is required");
  let xInFlight;
  let calendarInFlight;
  const summaryInFlight = new Map();

  return createServer(async (request, response) => {
    const authorized =
      request.headers.authorization === `Bearer ${token}`;
    if (!authorized) {
      jsonResponse(response, 401, { error: "Unauthorized" });
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, { ok: true, model: GROK_MODEL });
      return;
    }
    if (request.method === "GET" && url.pathname === "/x-trending-ai") {
      xInFlight ??= collector().finally(() => {
        xInFlight = undefined;
      });
      try {
        jsonResponse(response, 200, await xInFlight);
      } catch {
        jsonResponse(response, 503, {
          error: "Trending AI collector is temporarily unavailable",
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/yfsp-recent-movies") {
      try {
        jsonResponse(response, 200, await movieCollector());
      } catch {
        jsonResponse(response, 503, {
          error: "Recently Added movies are temporarily unavailable",
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/calendar-events") {
      calendarInFlight ??= calendarCollector().finally(() => {
        calendarInFlight = undefined;
      });
      try {
        jsonResponse(response, 200, await calendarInFlight);
      } catch {
        jsonResponse(response, 503, {
          error: "Calendar events are temporarily unavailable",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/summarize-hn") {
      try {
        const chunks = [];
        let byteCount = 0;
        for await (const chunk of request) {
          byteCount += chunk.length;
          if (byteCount > 160_000) {
            throw new Error("Request body too large");
          }
          chunks.push(chunk);
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const stories = validateHackerNewsSummaryInput(payload?.stories);
        const key = JSON.stringify(stories);
        let pending = summaryInFlight.get(key);
        if (!pending) {
          pending = summarizer({ stories }).finally(() => {
            summaryInFlight.delete(key);
          });
          summaryInFlight.set(key, pending);
        }
        jsonResponse(response, 200, await pending);
      } catch {
        jsonResponse(response, 503, {
          error: "Hacker News summaries are temporarily unavailable",
        });
      }
      return;
    }

    jsonResponse(response, 404, { error: "Not found" });
  });
}

async function main() {
  const token = process.env.GROK_X_COLLECTOR_TOKEN?.trim();
  if (!token) {
    console.error(
      "GROK_X_COLLECTOR_TOKEN is missing. Start the dashboard with npm run dev.",
    );
    process.exitCode = 1;
    return;
  }

  const portValue = Number(
    process.env.GROK_X_COLLECTOR_PORT ?? DEFAULT_COLLECTOR_PORT,
  );
  if (!Number.isInteger(portValue) || portValue < 1024 || portValue > 65_535) {
    console.error("GROK_X_COLLECTOR_PORT must be a valid local port.");
    process.exitCode = 1;
    return;
  }

  const server = createCollectorServer({ token });
  server.headersTimeout = GROK_TIMEOUT_MS + 10_000;
  server.requestTimeout = GROK_TIMEOUT_MS + 10_000;
  server.listen(portValue, "127.0.0.1", () => {
    console.log(
      `Local Grok ${GROK_MODEL} dashboard helper ready on 127.0.0.1:${portValue}`,
    );
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
