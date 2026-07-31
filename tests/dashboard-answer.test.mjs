import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  askDashboard,
  compactDashboardContext,
  DashboardAnswerState,
  dashboardAnswerArguments,
} from "../scripts/dashboard-answer.mjs";
import { sampleData } from "../app/data/sample-data.ts";

function snapshotWithFourteenTechStories() {
  const snapshot = structuredClone(sampleData);
  snapshot.techNews = Array.from({ length: 14 }, (_, index) => ({
    ...sampleData.techNews[index % sampleData.techNews.length],
    id: `tech-${index + 1}`,
    title: `Tech story ${index + 1}`,
    summary: `Summary for Tech story ${index + 1}.`,
    source: `Tech source ${index + 1}`,
    destinationUrl: `https://example.com/tech-${index + 1}`,
  }));
  return snapshot;
}

function snapshotWithSourceSpecificTechStories() {
  const snapshot = structuredClone(sampleData);
  const sources = ["The Verge", "MobileSyrup", "Wccftech", "iPhone in Canada"];
  snapshot.techNews = sources.flatMap((source) =>
    [1, 2].map((number) => ({
      ...sampleData.techNews[0],
      id: `${source}-${number}`,
      title: `${source} story ${number}`,
      summary: `Summary for ${source} story ${number}.`,
      source,
      destinationUrl: `https://example.com/${encodeURIComponent(source)}-${number}`,
    })),
  );
  return snapshot;
}

test("selects only the cached sections relevant to a question", () => {
  const snapshot = structuredClone(sampleData);
  snapshot.library = [
    {
      id: "private-note",
      title: "Private project",
      savedAt: snapshot.savedAt,
      tags: ["private"],
      summary: "This should not be sent for a Tesla-only question.",
      content: "Private full note body",
    },
  ];

  const selected = compactDashboardContext(
    snapshot,
    "What happened to Tesla stock?",
  );

  assert.deepEqual(selected.usedSections, ["market"]);
  assert.ok(selected.context.tesla);
  assert.equal("library" in selected.context, false);
  assert.equal("techNews" in selected.context, false);
});

test("Grok answers from cached context with web and local tools disabled", async () => {
  let captured;
  const output = await askDashboard("What is the weather?", sampleData, {
    environment: { PATH: "/usr/bin", HOME: "/tmp" },
    execute: async (executable, args, options) => {
      captured = { executable, args, options };
      return { stdout: "\u001b[32mIt is clear at the sample location.\u001b[0m\n" };
    },
  });

  assert.equal(output.answer, "It is clear at the sample location.");
  assert.deepEqual(output.usedSections, ["weather"]);
  assert.equal(captured.executable, "grok");
  assert.ok(captured.args.includes("--disable-web-search"));
  assert.ok(captured.args.includes("--disallowed-tools"));
  assert.ok(captured.args.includes("grok-4.5"));
  assert.equal(captured.options.cwd, tmpdir());

  const prompt = dashboardAnswerArguments(
    "What is the weather?",
    sampleData,
  ).at(-1);
  assert.match(prompt, /using only the supplied cached dashboard data/i);
  assert.match(prompt, /"weather"/);
  assert.doesNotMatch(prompt, /"library"/);
});

test("rejects an empty dashboard question before invoking Grok", async () => {
  await assert.rejects(
    askDashboard("   ", sampleData, {
      execute: async () => {
        throw new Error("should not run");
      },
    }),
    /between 1 and 1,000 characters/,
  );
});

test("lists every cached Trending AI item, in X then Hacker News order", async () => {
  const output = await askDashboard("Show Trending AI News", sampleData, {
    execute: async () => {
      throw new Error("complete Trending AI listings must not depend on Grok");
    },
  });
  const expectedItems = [...sampleData.trends, ...sampleData.hnTrends];

  assert.deepEqual(output.usedSections, ["trending-ai"]);
  assert.deepEqual(output.sources, expectedItems.map((item) => item.destinationUrl));
  for (const item of expectedItems) {
    assert.match(output.answer, new RegExp(item.title));
    assert.match(output.answer, new RegExp(`Source: ${item.source}`));
    assert.match(output.answer, new RegExp(`Summary: ${item.summary}`));
    assert.match(output.answer, new RegExp(`Public link: ${item.destinationUrl}`));
  }
  assert.ok(
    output.answer.indexOf(sampleData.trends[2].title) <
      output.answer.indexOf(sampleData.hnTrends[0].title),
  );
});

test("Tech News starts concise, while more and all respect one caller's snapshot state", async () => {
  const snapshot = snapshotWithFourteenTechStories();
  const state = new DashboardAnswerState();
  const neverRunGrok = async () => {
    throw new Error("deterministic Tech News listings must not depend on Grok");
  };

  const first = await askDashboard("Tech News", snapshot, {
    callerId: "caller-a",
    state,
    execute: neverRunGrok,
  });
  assert.match(first.answer, /items 1-3 of 14/);
  assert.match(first.answer, /Tech story 3/);
  assert.doesNotMatch(first.answer, /Tech story 4/);
  assert.deepEqual(first.sources, [
    "https://example.com/tech-1",
    "https://example.com/tech-2",
    "https://example.com/tech-3",
  ]);

  const more = await askDashboard("show more tech news", snapshot, {
    callerId: "caller-a",
    state,
    execute: neverRunGrok,
  });
  assert.match(more.answer, /items 4-14 of 14/);
  assert.match(more.answer, /Tech story 14/);
  assert.doesNotMatch(more.answer, /\n1\. Tech story 1\n/);

  const anotherCaller = await askDashboard("show more tech news", snapshot, {
    callerId: "caller-b",
    state,
    execute: neverRunGrok,
  });
  assert.match(anotherCaller.answer, /14 current items/);
  assert.match(anotherCaller.answer, /Tech story 1/);

  const all = await askDashboard("show all tech news", snapshot, {
    callerId: "caller-a",
    state,
    execute: neverRunGrok,
  });
  assert.match(all.answer, /14 current items/);
  assert.match(all.answer, /Tech story 1/);
  assert.match(all.answer, /Tech story 14/);
});

test("Tech News progress resets when the cached dashboard snapshot changes", async () => {
  const state = new DashboardAnswerState();
  const firstSnapshot = snapshotWithFourteenTechStories();
  const refreshedSnapshot = structuredClone(firstSnapshot);
  refreshedSnapshot.savedAt = "2026-07-31T12:00:00.000Z";
  refreshedSnapshot.techNews[0].title = "New first Tech story";

  await askDashboard("Tech News", firstSnapshot, {
    callerId: "caller-a",
    state,
    execute: async () => ({ stdout: "not used" }),
  });
  const moreAfterRefresh = await askDashboard(
    "show more tech news",
    refreshedSnapshot,
    {
      callerId: "caller-a",
      state,
      execute: async () => ({ stdout: "not used" }),
    },
  );

  assert.match(moreAfterRefresh.answer, /14 current items/);
  assert.match(moreAfterRefresh.answer, /New first Tech story/);
});

test("lists every card from an explicitly requested Tech News source without Grok", async () => {
  const snapshot = snapshotWithSourceSpecificTechStories();
  const requests = [
    ["show me Verge news", "The Verge"],
    ["show me all MobileSyrup news", "MobileSyrup"],
    ["show me Wccftech stories", "Wccftech"],
    ["show me all iPhone in Canada headlines", "iPhone in Canada"],
  ];

  for (const [question, source] of requests) {
    const output = await askDashboard(question, snapshot, {
      execute: async () => {
        throw new Error("source-specific Tech News must not depend on Grok");
      },
    });
    const expectedItems = snapshot.techNews.filter((item) => item.source === source);

    assert.deepEqual(output.usedSections, ["tech-news"]);
    assert.deepEqual(output.sources, expectedItems.map((item) => item.destinationUrl));
    for (const item of expectedItems) {
      assert.ok(output.answer.includes(item.title));
      assert.ok(output.answer.includes(`Source: ${item.source}`));
      assert.ok(output.answer.includes(`Summary: ${item.summary}`));
      assert.ok(output.answer.includes(`Public link: ${item.destinationUrl}`));
    }
    assert.equal(output.answer.includes("story 3"), false);
  }
});

test("recognizes natural requests for all Tech News", async () => {
  const snapshot = snapshotWithFourteenTechStories();
  const requests = [
    "list all Tech News",
    "give me all Tech News",
    "all Tech News",
  ];

  for (const question of requests) {
    const output = await askDashboard(question, snapshot, {
      execute: async () => {
        throw new Error("all Tech News must not depend on Grok");
      },
    });
    assert.match(output.answer, /14 current items/);
    assert.match(output.answer, /Tech story 1/);
    assert.match(output.answer, /Tech story 14/);
  }
});
