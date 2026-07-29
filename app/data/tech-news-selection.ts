import type { NewsItem, SourceName } from "./types";

export const TECH_PREFERENCE_KEY = "jack-dashboard-tech-preferences-v1";
export const TECH_STORIES_PER_SOURCE = 3;
export const VERGE_STORY_LIMIT = 5;
export const TECH_STORY_LIMIT = 14;

export type TechTopic =
  | "phones-gadgets"
  | "computing-chips"
  | "platforms-software"
  | "security-privacy"
  | "canada-telecom"
  | "gaming-entertainment"
  | "ai-tech"
  | "wildcard";

export type TechPreferenceProfile = {
  topicWeights: Partial<Record<TechTopic, number>>;
  recentUrls: string[];
};

const TECH_SOURCES = [
  "MobileSyrup",
  "Wccftech",
  "iPhone in Canada",
  "The Verge",
] as const satisfies readonly SourceName[];

const EXCLUDED_CONTENT =
  /\b(sponsored(?:\s+content)?|advertorial|affiliate|deal|deals|discount|sale|coupon|promo(?:tion)?|shopping guide|gift guide|what(?:'s| is) (?:new|streaming) on)\b/i;

const TOPIC_RULES: Array<{ topic: TechTopic; pattern: RegExp }> = [
  {
    topic: "phones-gadgets",
    pattern:
      /\b(iphone|ipad|pixel|galaxy|android|ios|smartphone|phone|tablet|airpods?|watch|wearable|camera|headphones?|earbuds?|gadget|device)\b/i,
  },
  {
    topic: "canada-telecom",
    pattern:
      /\b(canada|canadian|crtc|rogers|bell|telus|fido|koodo|freedom mobile|teksavvy|telecom|wireless|broadband|fibre|fiber|5g)\b/i,
  },
  {
    topic: "security-privacy",
    pattern:
      /\b(security|privacy|breach|hack|malware|ransomware|vulnerability|exploit|scam|spoof|encryption|surveillance)\b/i,
  },
  {
    topic: "computing-chips",
    pattern:
      /\b(cpu|gpu|chip|chips|semiconductor|nvidia|amd|intel|tsmc|qualcomm|snapdragon|laptop|macbook|computer|pc|memory|ram|processor)\b/i,
  },
  {
    topic: "ai-tech",
    pattern:
      /\b(ai|artificial intelligence|model|models|llm|agent|agents|openai|anthropic|claude|gemini|grok|inference)\b/i,
  },
  {
    topic: "gaming-entertainment",
    pattern:
      /\b(game|gaming|playstation|xbox|nintendo|steam|console|movie|streaming|netflix|disney|prime video)\b/i,
  },
  {
    topic: "platforms-software",
    pattern:
      /\b(apple|google|microsoft|amazon|meta|software|app|apps|windows|macos|browser|cloud|platform|service)\b/i,
  },
];

const TITLE_STOP_WORDS = new Set([
  "about",
  "after",
  "from",
  "have",
  "into",
  "more",
  "that",
  "their",
  "this",
  "with",
  "will",
  "your",
]);

function emptyProfile(): TechPreferenceProfile {
  return { topicWeights: {}, recentUrls: [] };
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function titleTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !TITLE_STOP_WORDS.has(word)),
  );
}

function sameEvent(left: NewsItem, right: NewsItem): boolean {
  const leftTokens = titleTokens(left.title);
  const rightTokens = titleTokens(right.title);
  if (!leftTokens.size || !rightTokens.size) return false;
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.7;
}

function isTechSource(source: SourceName): source is (typeof TECH_SOURCES)[number] {
  return TECH_SOURCES.includes(source as (typeof TECH_SOURCES)[number]);
}

export function categorizeTechArticle(item: Pick<NewsItem, "title" | "summary">): TechTopic {
  const text = `${item.title} ${item.summary}`;
  return TOPIC_RULES.find(({ pattern }) => pattern.test(text))?.topic ?? "wildcard";
}

export function readTechPreferenceProfile(): TechPreferenceProfile {
  if (typeof window === "undefined") return emptyProfile();
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TECH_PREFERENCE_KEY) ?? "",
    ) as Partial<TechPreferenceProfile>;
    return {
      topicWeights:
        parsed.topicWeights && typeof parsed.topicWeights === "object"
          ? parsed.topicWeights
          : {},
      recentUrls: Array.isArray(parsed.recentUrls)
        ? parsed.recentUrls.filter((value): value is string => typeof value === "string")
        : [],
    };
  } catch {
    return emptyProfile();
  }
}

export function updateTechPreferenceProfile(
  profile: TechPreferenceProfile,
  item: NewsItem,
): TechPreferenceProfile {
  const topic = categorizeTechArticle(item);
  const decayedWeights = Object.fromEntries(
    Object.entries(profile.topicWeights).map(([key, value]) => [
      key,
      Math.max(0, Number(value) * 0.92),
    ]),
  ) as Partial<Record<TechTopic, number>>;
  decayedWeights[topic] = Math.min(8, (decayedWeights[topic] ?? 0) + 1);

  const destination = canonicalUrl(item.destinationUrl);
  return {
    topicWeights: decayedWeights,
    recentUrls: [
      destination,
      ...profile.recentUrls.filter((url) => canonicalUrl(url) !== destination),
    ].slice(0, 24),
  };
}

export function recordTechNewsClick(item: NewsItem): void {
  if (typeof window === "undefined") return;
  try {
    const next = updateTechPreferenceProfile(readTechPreferenceProfile(), item);
    window.localStorage.setItem(TECH_PREFERENCE_KEY, JSON.stringify(next));
  } catch {
    // A blocked local preference store must never interfere with opening a story.
  }
}

function freshnessScore(item: NewsItem, now: Date): number {
  const ageHours =
    (now.getTime() - new Date(item.publishedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours)) return 0;
  return Math.max(0, 4 - Math.max(0, ageHours) / 24);
}

function cleanCandidates(items: NewsItem[], now: Date): NewsItem[] {
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const seenUrls = new Set<string>();
  return items.filter((item) => {
    if (!isTechSource(item.source)) return false;
    if (!item.title || !item.summary || !/^https:\/\//i.test(item.destinationUrl)) {
      return false;
    }
    if (EXCLUDED_CONTENT.test(`${item.title} ${item.summary}`)) return false;
    const publishedAt = new Date(item.publishedAt).getTime();
    if (!Number.isFinite(publishedAt) || publishedAt < cutoff) return false;
    const destination = canonicalUrl(item.destinationUrl);
    if (seenUrls.has(destination)) return false;
    seenUrls.add(destination);
    return true;
  });
}

export function selectDiverseTechNews(
  candidates: NewsItem[],
  profile: TechPreferenceProfile = emptyProfile(),
  now = new Date(),
): NewsItem[] {
  function fixedSourceItems(
    source: "Wccftech" | "The Verge",
    limit: number,
  ): NewsItem[] {
    const fixed: NewsItem[] = [];
    const seenUrls = new Set<string>();
    for (const item of candidates) {
      if (
        item.source !== source ||
        !item.title ||
        !item.summary ||
        !/^https:\/\//i.test(item.destinationUrl)
      ) {
        continue;
      }
      const destination = canonicalUrl(item.destinationUrl);
      if (seenUrls.has(destination)) continue;
      seenUrls.add(destination);
      fixed.push(item);
      if (fixed.length === limit) break;
    }
    return fixed;
  }
  const fixedWccftech = fixedSourceItems(
    "Wccftech",
    TECH_STORIES_PER_SOURCE,
  );
  const fixedVerge = fixedSourceItems("The Verge", VERGE_STORY_LIMIT);

  const pool = cleanCandidates(
    candidates.filter(
      (item) => item.source !== "Wccftech" && item.source !== "The Verge",
    ),
    now,
  );
  const selected: NewsItem[] = [];
  const topicCounts = new Map<TechTopic, number>();
  const recentUrls = new Set(profile.recentUrls.map(canonicalUrl));

  function score(item: NewsItem): number {
    const topic = categorizeTechArticle(item);
    const preference = Math.min(8, profile.topicWeights[topic] ?? 0) * 0.45;
    const diversityPenalty = (topicCounts.get(topic) ?? 0) * 1.35;
    const openedPenalty = recentUrls.has(canonicalUrl(item.destinationUrl)) ? 4 : 0;
    return freshnessScore(item, now) + preference - diversityPenalty - openedPenalty;
  }

  function chooseForSource(source: (typeof TECH_SOURCES)[number]): NewsItem | undefined {
    const available = pool
      .filter(
        (item) =>
          item.source === source &&
          !selected.includes(item) &&
          !selected.some((chosen) => sameEvent(item, chosen)),
      )
      .sort((left, right) => score(right) - score(left));
    return (
      available.find(
        (item) => (topicCounts.get(categorizeTechArticle(item)) ?? 0) < 2,
      ) ?? available[0]
    );
  }

  for (let round = 0; round < VERGE_STORY_LIMIT; round += 1) {
    for (const source of TECH_SOURCES) {
      const chosen =
        source === "Wccftech"
          ? fixedWccftech[round]
          : source === "The Verge"
            ? fixedVerge[round]
            : round < TECH_STORIES_PER_SOURCE
              ? chooseForSource(source)
              : undefined;
      if (!chosen) continue;
      selected.push(chosen);
      const topic = categorizeTechArticle(chosen);
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
  }

  if (selected.length < TECH_STORY_LIMIT) {
    const remaining = [...pool, ...fixedWccftech, ...fixedVerge]
      .filter(
        (item) =>
          !selected.includes(item) &&
          !selected.some((chosen) => sameEvent(item, chosen)),
      )
      .sort((left, right) => score(right) - score(left));
    selected.push(...remaining.slice(0, TECH_STORY_LIMIT - selected.length));
  }

  return selected.slice(0, TECH_STORY_LIMIT);
}
