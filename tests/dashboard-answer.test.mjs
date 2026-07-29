import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  askDashboard,
  compactDashboardContext,
  dashboardAnswerArguments,
} from "../scripts/dashboard-answer.mjs";
import { sampleData } from "../app/data/sample-data.ts";

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
      return { stdout: "\u001b[32mIt is clear in Sample location.\u001b[0m\n" };
    },
  });

  assert.equal(output.answer, "It is clear in Sample location.");
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
