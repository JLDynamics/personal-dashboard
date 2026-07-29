export type WccftechTrendingStory = {
  rank: number;
  title: string;
  url: string;
  activeReaders: number;
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

export function canonicalWccftechUrl(value: string): string | undefined {
  try {
    const url = new URL(decodeHtml(value));
    if (
      url.protocol !== "https:" ||
      !["wccftech.com", "www.wccftech.com"].includes(url.hostname)
    ) {
      return undefined;
    }
    url.hostname = "wccftech.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function parseWccftechTrendingStories(
  html: string,
  limit = 3,
): WccftechTrendingStory[] {
  const heading = html.search(
    /<h[1-6][^>]*>\s*Trending Stories\s*<\/h[1-6]>/i,
  );
  if (heading < 0) return [];

  const list = html
    .slice(heading)
    .match(/<ul(?:\s[^>]*)?>([\s\S]*?)<\/ul>/i)?.[1];
  if (!list) return [];

  const stories: WccftechTrendingStory[] = [];
  const seen = new Set<string>();
  for (const [, item] of list.matchAll(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi)) {
    const link = item.match(
      /<h4(?:\s[^>]*)?>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const readers = item.match(
      /<span(?:\s[^>]*)?>\s*([\d,]+)\s*<\/span>\s*<span(?:\s[^>]*)?>\s*Active Readers\s*<\/span>/i,
    );
    const url = link ? canonicalWccftechUrl(link[1]) : undefined;
    const title = link ? cleanText(link[2]) : "";
    const activeReaders = readers
      ? Number.parseInt(readers[1].replaceAll(",", ""), 10)
      : Number.NaN;

    if (!url || !title || !Number.isFinite(activeReaders) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    stories.push({
      rank: stories.length + 1,
      title,
      url,
      activeReaders,
    });
    if (stories.length === limit) break;
  }
  return stories;
}
