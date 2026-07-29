import { execFile } from "node:child_process";
import { access } from "node:fs/promises";

export const YFSP_RECENT_URL =
  "https://www.yfsp.tv/list/movie?orderBy=0&desc=true";
export const YFSP_TIMEOUT_MS = 15_000;

const MAX_HTML_BYTES = 5_000_000;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
].filter(Boolean);

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function firstAttribute(html, name) {
  const match = html.match(new RegExp(`\\b${name}="([^"]*)"`));
  return cleanText(match?.[1]);
}

function monogram(title) {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }
  return [...title].slice(0, 2).join("").toUpperCase();
}

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function shortenSynopsis(value, maxLength = 180) {
  const text = cleanText(value);
  const sentences =
    text.match(/[^。！？.!?]+[。！？.!?]+/g)?.slice(0, 2).join("") ?? text;
  if (sentences.length <= maxLength) return sentences;
  return `${sentences.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

export function parseYfspSynopsis(html, title) {
  const visibleSummary = html.match(
    /class="summary[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  )?.[1];
  const metaSummary = html.match(
    /<meta\b[^>]*(?:property="og:description"|name="description")[^>]*content="([^"]+)"/,
  )?.[1];
  const cleaned = cleanText(visibleSummary || metaSummary).replace(
    new RegExp(`^${escapedPattern(title)}\\s*[:：]\\s*`),
    "",
  );
  const summary = shortenSynopsis(cleaned);
  if (summary.length < 30) {
    throw new Error(`YFSP synopsis was unavailable for ${title}`);
  }
  return summary;
}

export function parseRecentYfspHtml(
  html,
  collectedAt = new Date(),
) {
  const start = html.indexOf('id="list-page"');
  if (start < 0) throw new Error("YFSP Recently Added list was not found");
  const section = html.slice(start);
  const cardPattern =
    /<div\b[^>]*class="v-c[^"]*"[^>]*>([\s\S]*?)(?=<div\b[^>]*class="v-c[^"]*"|$)/g;
  const seen = new Set();
  const items = [];

  for (const match of section.matchAll(cardPattern)) {
    const card = match[1];
    const sourceMatch = card.match(/href="\/play\/([A-Za-z0-9]+)"/);
    const titleAnchor = card.match(
      /<a\b[^>]*title="([^"]+)"[^>]*href="\/play\//,
    );
    const posterTag = card.match(
      /<img\b[^>]*class="poster[^"]*"[^>]*>/,
    )?.[0];
    if (!sourceMatch || !titleAnchor || !posterTag) continue;

    const sourceId = cleanText(sourceMatch[1]);
    const title = cleanText(titleAnchor[1]);
    const posterUrl = firstAttribute(posterTag, "src");
    if (
      !sourceId ||
      !title ||
      !posterUrl.startsWith("https://static.yfsp.tv/") ||
      seen.has(sourceId)
    ) {
      continue;
    }

    const genre = cleanText(
      card.match(
        /class="tag-text[^"]*"[^>]*>\s*<span[^>]*>([^<]+)/,
      )?.[1],
    );
    const rating = cleanText(
      card.match(/class="rating"[^>]*>([^<]+)/)?.[1],
    );
    const rank = items.length;
    const sourceAddedAt = new Date(
      collectedAt.getTime() - rank,
    ).toISOString();

    seen.add(sourceId);
    items.push({
      id: `yfsp-${sourceId}`,
      sourceId: `yfsp:${sourceId}`,
      title,
      year: "New",
      genre: genre.replace(/\s+/g, " · ") || "Movie",
      rating: rating || undefined,
      description: genre
        ? `Recently added ${genre.replace(/\s+/g, ", ")} movie.`
        : "Recently added movie.",
      sourceAddedAt,
      originalReleaseDate: "",
      releaseLabel: "Recently added",
      sourceEdition: "source-addition",
      posterUrl,
      posterAlt: `${title} poster`,
      posterClass: `poster-${["violet", "blue", "coral"][rank % 3]}`,
      monogram: monogram(title),
    });

    if (items.length === 3) break;
  }

  if (items.length !== 3) {
    throw new Error("YFSP did not return exactly three usable movie cards");
  }
  return { items };
}

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (!candidate.includes("/")) return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known local browser path.
    }
  }
  throw new Error("Chrome or Chromium is required for YFSP Recently Added");
}

function renderPage(executable, args) {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        encoding: "utf8",
        maxBuffer: MAX_HTML_BYTES,
        timeout: YFSP_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function chromeArguments(url, windowSize) {
  return [
    "--headless=new",
    "--incognito",
    "--disable-extensions",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    `--window-size=${windowSize}`,
    "--virtual-time-budget=10000",
    "--dump-dom",
    url,
  ];
}

export async function collectRecentYfspMovies({
  collectedAt = new Date(),
  render = renderPage,
} = {}) {
  const executable = await findChrome();
  const listHtml = await render(
    executable,
    chromeArguments(YFSP_RECENT_URL, "1920,3000"),
  );
  const result = parseRecentYfspHtml(String(listHtml), collectedAt);

  await Promise.all(
    result.items.map(async (movie) => {
      const sourceId = movie.sourceId.replace(/^yfsp:/, "");
      const detailHtml = await render(
        executable,
        chromeArguments(
          `https://www.yfsp.tv/play/${sourceId}`,
          "1920,1800",
        ),
      );
      movie.description = parseYfspSynopsis(
        String(detailHtml),
        movie.title,
      );
    }),
  );

  return result;
}
