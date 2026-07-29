export const ARTICLE_CONTENT_MAX_CHARS = 14_000;
export const ARTICLE_CONTENT_MIN_CHARS = 300;

const PRIVATE_HOST =
  /^(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|.*\.local)$/i;
const BOILERPLATE =
  /^(?:skip to content|sign in|sign up|subscribe|accept cookies|cookie settings|privacy policy|terms of (?:use|service)|share this|advertisement|all rights reserved)$/i;

export function publicArticleUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    PRIVATE_HOST.test(url.hostname)
  ) {
    return undefined;
  }
  url.hash = "";
  return url.toString();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    rdquo: "”",
    rsquo: "’",
  };
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (entity, name: string) =>
      named[name.toLowerCase()] ?? entity,
    );
}

function readableText(fragment: string): string {
  const withoutNoise = fragment
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(?:script|style|noscript|svg|canvas|nav|header|footer|aside|form|button)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg|canvas|nav|header|footer|aside|form|button)>/gi,
      " ",
    )
    .replace(/<(?:br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(
      /<\/(?:p|div|section|article|main|h[1-6]|li|blockquote|pre|tr)>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ");

  const seen = new Set<string>();
  return decodeHtml(withoutNoise)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(
      (line) =>
        line.length >= 20 &&
        !BOILERPLATE.test(line) &&
        !seen.has(line) &&
        (seen.add(line) || true),
    )
    .join("\n");
}

export function extractReadableArticleText(html: string): string {
  const candidates = [
    ...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi),
    ...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi),
  ]
    .map((match) => readableText(match[1]))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  const body =
    candidates[0] ??
    readableText(
      html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html,
    );
  const content = body.slice(0, ARTICLE_CONTENT_MAX_CHARS).trim();
  if (content.length < ARTICLE_CONTENT_MIN_CHARS) {
    throw new Error("Article did not expose enough readable content");
  }
  return content;
}
