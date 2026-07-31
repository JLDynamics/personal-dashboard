import { execFile } from "node:child_process";
import { tmpdir } from "node:os";

export const DASHBOARD_ANSWER_MODEL = "grok-4.5";
const ANSWER_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_BYTES = 250_000;
const TECH_NEWS_BATCH_SIZE = 3;
const MAX_CALLER_ID_LENGTH = 256;
const TECH_NEWS_SOURCES = [
  { source: "The Verge", pattern: /\b(?:the\s+)?verge\b/i },
  { source: "MobileSyrup", pattern: /\bmobilesyrup\b/i },
  { source: "Wccftech", pattern: /\bwccftech\b/i },
  { source: "iPhone in Canada", pattern: /\biphone\s+in\s+canada\b/i },
];
const DISALLOWED_LOCAL_TOOLS = [
  "read_file",
  "write",
  "search_replace",
  "run_terminal_command",
  "get_command_or_subagent_output",
  "list_dir",
  "todo_write",
].join(",");

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanCallerId(value) {
  if (typeof value !== "string") return "";
  const callerId = value.trim();
  if (callerId.length > MAX_CALLER_ID_LENGTH) {
    throw new Error("Caller ID must be at most 256 characters");
  }
  return callerId;
}

function newsItems(snapshot, section) {
  if (section === "trending-ai") {
    return [...(snapshot.trends ?? []), ...(snapshot.hnTrends ?? [])];
  }
  return snapshot.techNews ?? [];
}

function publicUrls(items) {
  return [
    ...new Set(
      items
        .map((item) => item.destinationUrl)
        .filter((value) => /^https:\/\//.test(value)),
    ),
  ];
}

function formatNewsItems(title, items, { start = 0, total = items.length } = {}) {
  if (!items.length) return `No current ${title} items are in the cached dashboard.`;

  const range = total === items.length ? `${total} current items` : `items ${start + 1}-${start + items.length} of ${total}`;
  return [
    `${title} (${range})`,
    ...items.map((item, index) => {
      const link = /^https:\/\//.test(item.destinationUrl)
        ? item.destinationUrl
        : "Unavailable in the cached dashboard";
      return [
        `${start + index + 1}. ${item.title || "Untitled"}`,
        `Source: ${item.source || "Unknown source"}`,
        `Summary: ${item.summary || "No summary supplied."}`,
        `Public link: ${link}`,
      ].join("\n");
    }),
  ].join("\n\n");
}

function dashboardListIntent(question) {
  const normalized = question.toLowerCase();
  if (/\bai\s+news\b|\btrending\s+(?:ai(?:\s+news)?|news)\b/.test(normalized)) {
    return "trending-ai";
  }
  if (/\ball\s+(?:the\s+)?tech\s+news\b/.test(normalized)) return "tech-all";
  if (/\bshow\s+more\s+tech\s+news\b/.test(normalized)) return "tech-more";
  if (/\btech\s+news\b/.test(normalized)) return "tech-first";
  return "";
}

function requestedTechNewsSource(question) {
  if (!/\b(?:news|stories|headlines)\b/i.test(question)) return "";
  return TECH_NEWS_SOURCES.find(({ pattern }) => pattern.test(question))?.source ?? "";
}

function deterministicDashboardAnswer(question, snapshot, { callerId, state }) {
  const source = requestedTechNewsSource(question);
  if (source) {
    const items = newsItems(snapshot, "tech-news").filter(
      (item) => item.source === source,
    );
    return {
      answer: formatNewsItems(`${source} Tech News`, items),
      usedSections: ["tech-news"],
      sources: publicUrls(items),
    };
  }

  const intent = dashboardListIntent(question);
  if (!intent) return null;

  if (intent === "trending-ai") {
    const items = newsItems(snapshot, "trending-ai");
    return {
      answer: formatNewsItems("Trending AI", items),
      usedSections: ["trending-ai"],
      sources: publicUrls(items),
    };
  }

  const batch = state.techBatch(
    callerId,
    snapshot,
    intent === "tech-all" ? "all" : intent === "tech-more" ? "more" : "first",
  );
  if (intent === "tech-more" && !batch.items.length && batch.total) {
    return {
      answer: `You've already seen all ${batch.total} current Tech News items in this dashboard snapshot.`,
      usedSections: ["tech-news"],
      sources: [],
    };
  }
  return {
    answer: formatNewsItems("Tech News", batch.items, batch),
    usedSections: ["tech-news"],
    sources: publicUrls(batch.items),
  };
}

function snapshotKey(snapshot) {
  return JSON.stringify({
    savedAt: snapshot.savedAt,
    techNews: (snapshot.techNews ?? []).map((item) => [
      item.id,
      item.contentHash,
      item.destinationUrl,
    ]),
  });
}

/**
 * Keeps pagination only for one explicit caller and one cached snapshot. The
 * caller supplies a stable opaque ID (for example, an MCP conversation ID).
 * Calls without one deliberately keep no state, so separate callers cannot
 * affect each other.
 */
export class DashboardAnswerState {
  #techNewsByCaller = new Map();

  techBatch(callerId, snapshot, mode) {
    const items = newsItems(snapshot, "tech-news");
    if (mode === "all") {
      this.#remember(callerId, snapshot, items);
      return { items, start: 0, total: items.length };
    }

    if (mode === "first") {
      const batch = items.slice(0, TECH_NEWS_BATCH_SIZE);
      this.#remember(callerId, snapshot, batch);
      return { items: batch, start: 0, total: items.length };
    }

    const key = snapshotKey(snapshot);
    const remembered = callerId && this.#techNewsByCaller.get(callerId);
    const shown = remembered?.snapshotKey === key ? remembered.shown : new Set();
    const start = items.findIndex((item) => !shown.has(item.id));
    const batch = items.filter((item) => !shown.has(item.id));

    this.#remember(callerId, snapshot, batch, shown);
    return {
      items: batch,
      start: start === -1 ? items.length : start,
      total: items.length,
    };
  }

  #remember(callerId, snapshot, items, existingShown = new Set()) {
    if (!callerId) return;
    const shown = new Set(existingShown);
    for (const item of items) shown.add(item.id);
    this.#techNewsByCaller.set(callerId, { snapshotKey: snapshotKey(snapshot), shown });
  }
}

function selectedSections(question) {
  const normalized = question.toLowerCase();
  const sections = [];
  const rules = [
    ["trending-ai", /\b(ai|artificial|grok|x|twitter|hacker news|hn|agent)\b/],
    ["tech-news", /\b(tech|technology|phone|iphone|android|computer|chip|software)\b/],
    ["market", /\b(tesla|tsla|stock|market|share|price)\b/],
    ["weather", /\b(weather|temperature|rain|snow|storm|forecast|outside)\b/],
    ["calendar", /\b(calendar|schedule|appointment|meeting|event|today|tomorrow)\b/],
    ["movies", /\b(movie|movies|watch|film|cinema)\b/],
    ["library", /\b(note|notes|library|saved|conversation|project|remember)\b/],
  ];
  for (const [name, pattern] of rules) {
    if (pattern.test(normalized)) sections.push(name);
  }
  return sections.length ? sections : rules.map(([name]) => name);
}

function compactNews(items, limit) {
  return items.slice(0, limit).map((item) => ({
    title: item.title,
    summary: item.summary,
    source: item.source,
    publishedAt: item.publishedAt,
    destinationUrl: item.destinationUrl,
    signal: item.signal,
  }));
}

export function compactDashboardContext(snapshot, question) {
  const usedSections = selectedSections(question);
  const context = {
    asOf: snapshot.savedAt,
    sourceStatus: {},
  };
  const sources = [];

  if (usedSections.includes("trending-ai")) {
    context.sourceStatus.x = snapshot.sourceStatus.x;
    context.sourceStatus.hn = snapshot.sourceStatus.hn;
    context.trendingAi = {
      x: compactNews(snapshot.trends, 3),
      hackerNews: compactNews(snapshot.hnTrends, 3),
    };
    sources.push(
      ...snapshot.trends.map((item) => item.destinationUrl),
      ...snapshot.hnTrends.map((item) => item.destinationUrl),
    );
  }
  if (usedSections.includes("tech-news")) {
    context.sourceStatus.tech = snapshot.sourceStatus.tech;
    context.techNews = compactNews(snapshot.techNews, 14);
    sources.push(...snapshot.techNews.map((item) => item.destinationUrl));
  }
  if (usedSections.includes("market")) {
    context.sourceStatus.market = snapshot.sourceStatus.market;
    context.tesla = snapshot.tesla;
  }
  if (usedSections.includes("weather")) {
    context.sourceStatus.weather = snapshot.sourceStatus.weather;
    context.weather = snapshot.weather;
  }
  if (usedSections.includes("calendar")) {
    context.sourceStatus.calendar = snapshot.sourceStatus.calendar;
    context.schedule = snapshot.schedule;
  }
  if (usedSections.includes("movies")) {
    context.sourceStatus.movies = snapshot.sourceStatus.movies;
    context.movies = snapshot.movies.map((movie) => ({
      title: movie.title,
      year: movie.year,
      genre: movie.genre,
      description: movie.description,
      sourceAddedAt: movie.sourceAddedAt,
      originalReleaseDate: movie.originalReleaseDate,
    }));
  }
  if (usedSections.includes("library")) {
    context.sourceStatus.library = snapshot.sourceStatus.library;
    context.library = snapshot.library.map((note) => ({
      title: note.title,
      savedAt: note.savedAt,
      tags: note.tags,
      summary: note.summary,
    }));
  }

  return {
    context,
    usedSections,
    sources: [...new Set(sources.filter((value) => /^https:\/\//.test(value)))].slice(
      0,
      12,
    ),
  };
}

export function dashboardAnswerArguments(question, snapshot) {
  const { context } = compactDashboardContext(snapshot, question);
  const prompt = [
    "Answer the user's dashboard question using only the supplied cached dashboard data.",
    "Do not search the web or X. Do not use local tools. Do not invent missing facts.",
    "If the cache does not contain the answer, say that plainly.",
    "Keep the answer concise and mention when the data was last updated when freshness matters.",
    "",
    `Question: ${question}`,
    `Cached dashboard data: ${JSON.stringify(context)}`,
  ].join("\n");

  return [
    "--model",
    DASHBOARD_ANSWER_MODEL,
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
    prompt,
  ];
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
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        ...options,
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: ANSWER_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout });
      },
    );
  });
}

/**
 * @param {string} question
 * @param {object} snapshot
 * @param {{
 *   execute?: typeof executeGrok,
 *   environment?: NodeJS.ProcessEnv,
 *   callerId?: string,
 *   state?: DashboardAnswerState,
 * }} options
 */
export async function askDashboard(
  question,
  snapshot,
  {
    execute = executeGrok,
    environment = process.env,
    callerId,
    state = new DashboardAnswerState(),
  } = {},
) {
  const cleanedQuestion = cleanText(question);
  if (!cleanedQuestion || cleanedQuestion.length > 1_000) {
    throw new Error("Question must contain between 1 and 1,000 characters");
  }
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Dashboard cache is unavailable");
  }

  const cleanedCallerId = cleanCallerId(callerId);
  const deterministic = deterministicDashboardAnswer(cleanedQuestion, snapshot, {
    callerId: cleanedCallerId,
    state,
  });
  if (deterministic) {
    return {
      ...deterministic,
      asOf: snapshot.savedAt,
    };
  }

  const selected = compactDashboardContext(snapshot, cleanedQuestion);
  const executable = environment.GROK_CLI_PATH?.trim() || "grok";
  const { stdout } = await execute(
    executable,
    dashboardAnswerArguments(cleanedQuestion, snapshot),
    {
      cwd: tmpdir(),
      env: minimalGrokEnvironment(environment),
    },
  );
  // ANSI color escapes are control characters by definition.
  // eslint-disable-next-line no-control-regex
  const answer = String(stdout).replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (!answer || answer.length > 5_000) {
    throw new Error("Grok returned an invalid dashboard answer");
  }

  return {
    answer,
    asOf: snapshot.savedAt,
    usedSections: selected.usedSections,
    sources: selected.sources,
  };
}
