import { execFile } from "node:child_process";
import { tmpdir } from "node:os";

export const DASHBOARD_ANSWER_MODEL = "grok-4.5";
const ANSWER_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_BYTES = 250_000;
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

export async function askDashboard(
  question,
  snapshot,
  {
    execute = executeGrok,
    environment = process.env,
  } = {},
) {
  const cleanedQuestion = cleanText(question);
  if (!cleanedQuestion || cleanedQuestion.length > 1_000) {
    throw new Error("Question must contain between 1 and 1,000 characters");
  }
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Dashboard cache is unavailable");
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
