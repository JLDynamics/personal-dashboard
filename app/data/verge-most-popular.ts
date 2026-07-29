export type VergePopularStory = {
  rank: number;
  title: string;
  url: string;
  publishedAt: string;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

function cleanText(value: string): string {
  return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function attributeValue(tag: string, name: string): string {
  const match = tag.match(
    new RegExp(`\\b${name}=["']([^"']+)["']`, "i"),
  );
  return match ? decodeHtml(match[1]).trim() : "";
}

export function canonicalVergeUrl(value: string): string | undefined {
  try {
    const url = new URL(decodeHtml(value), "https://www.theverge.com/");
    if (
      url.protocol !== "https:" ||
      !["theverge.com", "www.theverge.com"].includes(url.hostname)
    ) {
      return undefined;
    }
    url.hostname = "www.theverge.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function normalizePublishedAt(value: string): string {
  const withTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value}Z`
    : value;
  const date = new Date(withTimezone);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export function parseVergeMostPopular(
  html: string,
  limit = 5,
): VergePopularStory[] {
  const section = html.match(
    /<section[^>]*class=["'][^"']*\bduet--homepage--most-popular\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
  )?.[1];
  const list = section?.match(/<ol(?:\s[^>]*)?>([\s\S]*?)<\/ol>/i)?.[1];
  if (!list) return [];

  const stories: VergePopularStory[] = [];
  const seen = new Set<string>();
  for (const [, item] of list.matchAll(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi)) {
    const anchorTag = item.match(/<a\b[^>]*>/i)?.[0] ?? "";
    const link = item.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    const timeTag = item.match(/<time\b[^>]*>/i)?.[0] ?? "";
    const url = canonicalVergeUrl(attributeValue(anchorTag, "href"));
    const title = link ? cleanText(link[1]) : "";
    const publishedAt = normalizePublishedAt(attributeValue(timeTag, "dateTime"));

    if (!url || !title || !publishedAt || seen.has(url)) continue;
    seen.add(url);
    stories.push({
      rank: stories.length + 1,
      title,
      url,
      publishedAt,
    });
    if (stories.length === limit) break;
  }
  return stories;
}

export function parseVergeArticleDescription(
  html: string,
): string | undefined {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = attributeValue(tag, "name").toLowerCase();
    const property = attributeValue(tag, "property").toLowerCase();
    if (name !== "description" && property !== "og:description") continue;
    const content = cleanText(attributeValue(tag, "content"));
    if (content) return content;
  }
  return undefined;
}
