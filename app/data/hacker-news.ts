import type { HackerNewsItem } from "./types";

export const HN_BATCH_SIZE = 5;
export const HN_STORY_CAP = 30;
export const HN_RESULT_COUNT = 3;
export const HN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const AI_TOPIC =
  /\b(?:ai|artificial intelligence|machine learning|deep learning|large language models?|llms?|agentic|ai agents?|inference|reasoning models?|neural networks?|transformers?|attention (?:architectures?|mechanisms?|variants?)|embeddings?|vector databases?|retrieval augmented generation|rag|model context protocol|mcp|openai|anthropic|claude|chatgpt|gpt[-\s]?\d|codex|google deepmind|gemini|xai|grok|meta ai|llama|mistral|cohere|hugging face|qwen|deepseek|kimi|minimax|cursor)\b/i;
const NON_NEWS_PREFIX =
  /^(?:ask hn|show hn|tell hn|launch hn|who is hiring|freelancer|monthly hiring thread)\s*:/i;
const AD_OR_JOB =
  /\b(?:sponsored|advertisement|promo code|limited[- ]time offer|we are hiring|job opening|jobs at)\b/i;
const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

export type HackerNewsApiStory = {
  id?: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  dead?: boolean;
  deleted?: boolean;
};

export type RankedHackerNewsStory = {
  id: number;
  rank: number;
  title: string;
  articleUrl: string;
  discussionUrl: string;
  score: number;
  commentCount: number;
  publishedAt: string;
};

export type FetchHackerNewsJson = (url: string) => Promise<unknown>;

function canonicalArticleUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!["http:", "https:"].includes(url.protocol)) return undefined;
  if (
    url.hostname.toLowerCase() === "news.ycombinator.com" &&
    url.pathname === "/item"
  ) {
    return undefined;
  }

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|ref|source)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length > 2 && !TITLE_STOP_WORDS.has(token)),
  );
}

function isLikelySameEvent(
  left: RankedHackerNewsStory,
  right: RankedHackerNewsStory,
): boolean {
  if (left.articleUrl === right.articleUrl) return true;
  const leftTokens = titleTokens(left.title);
  const rightTokens = titleTokens(right.title);
  if (leftTokens.size < 4 || rightTokens.size < 4) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.75;
}

export function qualifyHackerNewsStory(
  value: unknown,
  rank: number,
  now = new Date(),
): RankedHackerNewsStory | undefined {
  if (!value || typeof value !== "object") return undefined;
  const story = value as HackerNewsApiStory;
  const title = story.title?.replace(/\s+/g, " ").trim() ?? "";
  const articleUrl = story.url ? canonicalArticleUrl(story.url) : undefined;
  const publishedAtMs =
    typeof story.time === "number" ? story.time * 1_000 : Number.NaN;
  const age = now.getTime() - publishedAtMs;

  if (
    story.type !== "story" ||
    story.dead ||
    story.deleted ||
    typeof story.id !== "number" ||
    !title ||
    !articleUrl ||
    NON_NEWS_PREFIX.test(title) ||
    AD_OR_JOB.test(title) ||
    !AI_TOPIC.test(title) ||
    !Number.isFinite(publishedAtMs) ||
    age < 0 ||
    age > HN_MAX_AGE_MS
  ) {
    return undefined;
  }

  return {
    id: story.id,
    rank,
    title,
    articleUrl,
    discussionUrl: `https://news.ycombinator.com/item?id=${story.id}`,
    score:
      typeof story.score === "number" && story.score >= 0 ? story.score : 0,
    commentCount:
      typeof story.descendants === "number" && story.descendants >= 0
        ? story.descendants
        : 0,
    publishedAt: new Date(publishedAtMs).toISOString(),
  };
}

export async function selectRankedHackerNewsStories(
  fetchJson: FetchHackerNewsJson,
  now = new Date(),
): Promise<RankedHackerNewsStory[]> {
  const topStoriesValue = await fetchJson(
    "https://hacker-news.firebaseio.com/v0/topstories.json",
  );
  if (!Array.isArray(topStoriesValue)) {
    throw new Error("Hacker News topstories response was invalid");
  }

  const topStoryIds = topStoriesValue
    .filter((id): id is number => Number.isInteger(id) && id > 0)
    .slice(0, HN_STORY_CAP);
  const selected: RankedHackerNewsStory[] = [];

  for (
    let offset = 0;
    offset < topStoryIds.length && selected.length < HN_RESULT_COUNT;
    offset += HN_BATCH_SIZE
  ) {
    const batch = topStoryIds.slice(offset, offset + HN_BATCH_SIZE);
    const stories = await Promise.all(
      batch.map((id) =>
        fetchJson(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
        ).catch(() => undefined),
      ),
    );

    for (let index = 0; index < stories.length; index += 1) {
      const candidate = qualifyHackerNewsStory(
        stories[index],
        offset + index + 1,
        now,
      );
      if (
        candidate &&
        !selected.some((existing) => isLikelySameEvent(existing, candidate))
      ) {
        selected.push(candidate);
        if (selected.length === HN_RESULT_COUNT) break;
      }
    }
  }

  return selected;
}

export function safeHackerNewsSummary(
  story: RankedHackerNewsStory,
): string {
  const commentLabel = story.commentCount === 1 ? "comment" : "comments";
  return `Ranked #${story.rank} on Hacker News with ${story.score} points and ${story.commentCount} ${commentLabel}.`;
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function toHackerNewsItem(
  story: RankedHackerNewsStory,
  summary = safeHackerNewsSummary(story),
  now = new Date(),
): HackerNewsItem {
  const elapsedMs = Math.max(
    0,
    now.getTime() - new Date(story.publishedAt).getTime(),
  );
  const ageHours = Math.floor(elapsedMs / 3_600_000);
  const age =
    ageHours < 1
      ? `${Math.max(1, Math.floor(elapsedMs / 60_000))}m`
      : ageHours < 24
        ? `${ageHours}h`
        : `${Math.floor(ageHours / 24)}d`;

  return {
    id: `hn-${story.id}`,
    title: story.title,
    summary,
    source: "Hacker News",
    age,
    publishedAt: story.publishedAt,
    contentHash: stableHash(
      `${story.title}:${summary}:${story.articleUrl}:${story.score}:${story.commentCount}`,
    ),
    destinationUrl: story.articleUrl,
    signal: `#${story.rank} · ${story.score} points`,
    discussionUrl: story.discussionUrl,
    hnRank: story.rank,
    score: story.score,
    commentCount: story.commentCount,
  };
}
