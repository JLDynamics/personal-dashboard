import assert from "node:assert/strict";
import test from "node:test";

import {
  GROK_MODEL,
  HN_SUMMARY_PROMPT,
  MOVIE_TRANSLATION_PROMPT,
  collectTrendingAi,
  createEnglishMovieCollector,
  grokArguments,
  hackerNewsSummaryArguments,
  movieTranslationArguments,
  parseGrokCliOutput,
  summarizeHackerNewsStories,
  translateMoviesToEnglish,
  validateHackerNewsSummaries,
  validateGrokPayload,
  validateMovieTranslations,
} from "../scripts/grok-x-collector.mjs";

const validItems = [
  {
    headline: "Grok 4.5 rollout drives a fast-moving X discussion",
    summary:
      "Developers are comparing the new model with earlier releases and sharing concrete tool-use results.",
    url: "https://x.com/i/trending/2080729042374820132",
  },
  {
    headline: "Open-weight AI policy debate gains momentum",
    summary:
      "Researchers and builders are discussing a new policy push around downloadable model weights.",
    url: "https://x.com/example/status/2080650739823890443",
  },
  {
    headline: "Agent model release attracts practical deployment tests",
    summary:
      "Builders are sharing benchmarks and early deployment notes for a newly released family of agent models.",
    url: "https://x.com/i/trending/2080363005372772749?ref_src=test",
  },
];

test("validates and normalizes three distinct Grok X clusters", () => {
  const result = validateGrokPayload(
    { items: validItems },
    new Date("2026-07-28T17:00:00.000Z"),
  );

  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].source, "X Explore");
  assert.equal(result.items[0].publishedAt, "2026-07-28T17:00:00.000Z");
  assert.equal(result.items[0].signal, "Trending now");
  assert.equal(
    result.items[2].destinationUrl,
    "https://x.com/i/trending/2080363005372772749",
  );
  assert.match(result.items[0].id, /^grok-x-[0-9a-f]{8}$/);
});

test("rejects malformed, duplicate, and non-public-X collector output", () => {
  assert.throws(
    () =>
      validateGrokPayload({
        items: [
          ...validItems.slice(0, 2),
          { ...validItems[0] },
          {
            ...validItems[2],
            url: "https://api.x.com/private/search",
          },
        ],
      }),
    /exactly 3/,
  );
});

test("tolerates a structured result wrapped in mixed CLI output", () => {
  const wrapped = JSON.stringify({
    result: JSON.stringify({ items: validItems }),
  });
  const parsed = parseGrokCliOutput(`status line\n${wrapped}\n`);
  assert.deepEqual(parsed.items, validItems);
});

test("parses the approved prompt's fenced JSON array and link field", () => {
  const cliOutput = `I'll search X now.
\`\`\`json
${JSON.stringify(
  validItems.map(({ url, ...item }) => ({ ...item, link: url })),
)}
\`\`\``;
  const parsed = parseGrokCliOutput(cliOutput);
  const validated = validateGrokPayload(
    parsed,
    new Date("2026-07-28T17:00:00.000Z"),
  );
  assert.equal(validated.items.length, 3);
  assert.equal(validated.items[0].destinationUrl, validItems[0].url);
});

test("collector invokes explicit Grok 4.5 with safe plain output", async () => {
  let invocation;
  const result = await collectTrendingAi({
    now: new Date("2026-07-28T17:00:00.000Z"),
    environment: {
      PATH: "/usr/bin",
      HOME: "/tmp/fake-home",
      GROK_CLI_PATH: "/fake/grok",
    },
    execute: async (executable, args, options) => {
      invocation = { executable, args, options };
      return { stdout: JSON.stringify({ items: validItems }) };
    },
  });

  assert.equal(result.items.length, 3);
  assert.equal(invocation.executable, "/fake/grok");
  assert.equal(invocation.args[invocation.args.indexOf("--model") + 1], GROK_MODEL);
  assert.equal(
    invocation.args[invocation.args.indexOf("--output-format") + 1],
    "plain",
  );
  assert.equal(invocation.args.includes("--json-schema"), false);
  assert.ok(invocation.args.includes("--no-memory"));
  assert.ok(invocation.args.includes("--no-subagents"));
  assert.equal(invocation.options.env.HOME, "/tmp/fake-home");
  assert.equal(invocation.options.env.GROK_X_COLLECTOR_TOKEN, undefined);
});

test("uses the approved short Grok prompt exactly", () => {
  const args = grokArguments();
  const prompt = args[args.indexOf("--single") + 1];
  assert.equal(
    prompt,
    "Search X for the top 3 AI news stories trending right now. For each, return headline, one-sentence summary, and public X link. Skip ads and duplicates. Return JSON only.",
  );
});

const hnStories = [
  {
    id: "101",
    title: "OpenAI releases an inference update",
    url: "https://example.com/openai",
    content: "OpenAI released an inference update with benchmark results, deployment details, limitations, and supporting evidence. ".repeat(5),
  },
  {
    id: "102",
    title: "Anthropic publishes Claude research",
    url: "https://example.com/claude",
    content: "Anthropic published research describing the method, experiment design, measured outcomes, limitations, and release details. ".repeat(5),
  },
  {
    id: "103",
    title: "Kimi architecture notes",
    url: "https://example.com/kimi",
    content: "The Kimi architecture article explains each component, the training setup, evaluation results, tradeoffs, and implementation notes. ".repeat(5),
  },
];

test("HN summarizer uses one explicit Grok 4.5 no-search call", async () => {
  let invocation;
  const summaries = hnStories.map(({ id, title }) => ({
    id,
    summary: `${title} is summarized factually from the supplied full article text.`,
  }));
  const result = await summarizeHackerNewsStories({
    stories: hnStories,
    environment: {
      PATH: "/usr/bin",
      HOME: "/tmp/fake-home",
      GROK_CLI_PATH: "/fake/grok",
    },
    execute: async (executable, args, options) => {
      invocation = { executable, args, options };
      return { stdout: `\`\`\`json\n${JSON.stringify(summaries)}\n\`\`\`` };
    },
  });

  assert.equal(result.items.length, 3);
  assert.equal(invocation.executable, "/fake/grok");
  assert.equal(invocation.args[invocation.args.indexOf("--model") + 1], "grok-4.5");
  assert.equal(invocation.args[invocation.args.indexOf("--max-turns") + 1], "1");
  assert.ok(invocation.args.includes("--disable-web-search"));
  assert.equal(invocation.options.timeoutMs, 35_000);
  const prompt = invocation.args[invocation.args.indexOf("--single") + 1];
  assert.ok(prompt.startsWith(HN_SUMMARY_PROMPT));
  assert.match(prompt, /"id":"101"/);
  assert.match(prompt, /"content":/);
  assert.doesNotMatch(prompt, /"score":|"comments":|"rank":/);
});

test("rejects missing, invented, or malformed HN summaries", () => {
  assert.throws(
    () =>
      validateHackerNewsSummaries(
        {
          items: [
            { id: "101", summary: "A valid factual summary with enough detail." },
            { id: "102", summary: "A second valid factual summary with enough detail." },
            { id: "999", summary: "An invented story summary with enough detail." },
          ],
        },
        hnStories,
      ),
    /invalid Hacker News summary/,
  );
});

test("HN summary arguments contain only supplied stories and disable search", () => {
  const args = hackerNewsSummaryArguments(hnStories);
  const prompt = args[args.indexOf("--single") + 1];
  assert.ok(prompt.startsWith(HN_SUMMARY_PROMPT));
  assert.ok(args.includes("--disable-web-search"));
  assert.doesNotMatch(prompt, /Search X for/i);
  assert.match(prompt, /full article text/i);
});

const moviesToTranslate = [
  {
    id: "yfsp-one",
    title: "利未记",
    genre: "爱情 · 科幻 · 恐怖",
    description:
      "父亲过世后，纳伊姆与母亲搬到一座保守的宗教小镇，试图展开全新生活。",
    posterAlt: "利未记 poster",
    monogram: "利未",
    posterUrl: "https://static.yfsp.tv/one.jpg",
  },
  {
    id: "yfsp-two",
    title: "烈焰狂沙",
    genre: "剧情 · 动作 · 犯罪",
    description:
      "禁毒警察深入危险境地，并在调查中揭开一个庞大的毒品走私网络。",
    posterAlt: "烈焰狂沙 poster",
    monogram: "烈焰",
    posterUrl: "https://static.yfsp.tv/two.jpg",
  },
  {
    id: "yfsp-three",
    title: "超级少女",
    genre: "动作 · 科幻 · 奇幻",
    description:
      "超级少女与意想不到的盟友横跨星际，对抗一位袭击她家园的强大敌人。",
    posterAlt: "超级少女 poster",
    monogram: "超级",
    posterUrl: "https://static.yfsp.tv/three.jpg",
  },
];

const englishMovies = [
  {
    id: "yfsp-one",
    title: "Leviticus",
    genre: "Romance · Science fiction · Horror",
    description:
      "After his father dies, Naim and his mother move to a conservative religious town to begin a new life.",
  },
  {
    id: "yfsp-two",
    title: "Blazing Sands",
    genre: "Drama · Action · Crime",
    description:
      "Narcotics officers enter dangerous territory and uncover a large drug-smuggling network.",
  },
  {
    id: "yfsp-three",
    title: "Supergirl",
    genre: "Action · Science fiction · Fantasy",
    description:
      "Supergirl crosses the stars with an unexpected ally to confront the enemy who attacked her home.",
  },
];

test("translates all three movie cards in one no-search Grok call", async () => {
  let invocation;
  const result = await translateMoviesToEnglish({
    movies: moviesToTranslate,
    environment: {
      PATH: "/usr/bin",
      HOME: "/tmp/fake-home",
      GROK_CLI_PATH: "/fake/grok",
    },
    execute: async (executable, args, options) => {
      invocation = { executable, args, options };
      return { stdout: JSON.stringify(englishMovies) };
    },
  });

  assert.deepEqual(
    result.items.map(({ title, genre, description }) => ({
      title,
      genre,
      description,
    })),
    englishMovies.map(({ title, genre, description }) => ({
      title,
      genre,
      description,
    })),
  );
  assert.equal(result.items[0].posterUrl, moviesToTranslate[0].posterUrl);
  assert.equal(result.items[1].posterAlt, "Blazing Sands poster");
  assert.equal(invocation.executable, "/fake/grok");
  assert.equal(invocation.options.timeoutMs, 20_000);
  assert.ok(invocation.args.includes("--disable-web-search"));
  const prompt = invocation.args[invocation.args.indexOf("--single") + 1];
  assert.ok(prompt.startsWith(MOVIE_TRANSLATION_PROMPT));
});

test("rejects untranslated movie fields and caches unchanged translations", async () => {
  assert.throws(
    () =>
      validateMovieTranslations(
        {
          items: englishMovies.map((movie, index) =>
            index === 1 ? { ...movie, title: "烈焰狂沙" } : movie,
          ),
        },
        moviesToTranslate,
      ),
    /invalid movie translation/,
  );

  let translations = 0;
  const collector = createEnglishMovieCollector({
    collect: async () => ({ items: moviesToTranslate }),
    translate: async () => {
      translations += 1;
      return validateMovieTranslations(
        { items: englishMovies },
        moviesToTranslate,
      );
    },
  });
  await collector();
  await collector();
  assert.equal(translations, 1);
});

test("movie translation arguments request only supplied text", () => {
  const args = movieTranslationArguments(moviesToTranslate);
  const prompt = args[args.indexOf("--single") + 1];
  assert.ok(prompt.startsWith(MOVIE_TRANSLATION_PROMPT));
  assert.ok(args.includes("--disable-web-search"));
  assert.doesNotMatch(prompt, /Search X for/i);
  assert.match(prompt, /"title":"利未记"/);
});
