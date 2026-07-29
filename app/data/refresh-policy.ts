import type { NewsItem } from "./types";

const MAX_AI_ITEM_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const AI_TERMS =
  /\b(ai|agent|agents|model|models|llm|claude|codex|openai|anthropic|langgraph|inference|benchmark|api)\b/i;
const EVIDENCE_TERMS =
  /\b(release|released|launch|launches|upgrade|upgrades|adds|built|production|repository|repo|paper|benchmark|api|sdk|tool|demo|workflow|code|research|open-weight|policy)\b/i;
const ENGAGEMENT_BAIT =
  /\b(game over|you won'?t believe|this changes everything|like hiring .* for free|comment .{0,20}(send|dm)|\d+x your)\b/i;

export type RefreshFilterResult = {
  accepted: NewsItem[];
  observedFingerprints: string[];
  candidateCount: number;
  skippedSeen: number;
  rejectedByRules: number;
};

function fingerprint(item: NewsItem) {
  return `${item.id}:${item.contentHash}`;
}

export function filterNewAiCandidates(
  candidates: NewsItem[],
  seenFingerprints: ReadonlySet<string>,
  now = new Date(),
): RefreshFilterResult {
  const unique = new Map<string, NewsItem>();

  for (const candidate of candidates) {
    const key = fingerprint(candidate);
    if (!unique.has(key)) unique.set(key, candidate);
  }

  const accepted: NewsItem[] = [];
  const observedFingerprints: string[] = [];
  let skippedSeen = 0;
  let rejectedByRules = 0;

  for (const [key, candidate] of unique) {
    observedFingerprints.push(key);

    if (seenFingerprints.has(key)) {
      skippedSeen += 1;
      continue;
    }

    const text = `${candidate.title} ${candidate.summary}`;
    const publishedAt = new Date(candidate.publishedAt).getTime();
    const stale =
      !Number.isFinite(publishedAt) ||
      now.getTime() - publishedAt > MAX_AI_ITEM_AGE_MS;
    const relevant = AI_TERMS.test(text);
    const evidenceBacked = EVIDENCE_TERMS.test(text);
    const bait = ENGAGEMENT_BAIT.test(text);

    if (stale || !relevant || !evidenceBacked || bait) {
      rejectedByRules += 1;
      continue;
    }

    accepted.push(candidate);
  }

  return {
    accepted,
    observedFingerprints,
    candidateCount: unique.size,
    skippedSeen,
    rejectedByRules,
  };
}

/*
 * Optional future integration point:
 * Only `accepted` items from filterNewAiCandidates may be passed to an AI
 * reviewer. This version deliberately returns them directly and makes no
 * model, ranking, or summarization calls.
 */
export function candidatesForOptionalAiReview(
  result: RefreshFilterResult,
): NewsItem[] {
  return result.accepted;
}
