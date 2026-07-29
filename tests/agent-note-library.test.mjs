import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAgentNoteLibrary,
  legacySummaryFromNoteText,
} from "../scripts/agent-note-library.mjs";

test("builds a legacy body fallback without a model", () => {
  assert.equal(
    legacySummaryFromNoteText(
      "# Integration notes\n\n- The dashboard reads recent notes through Agent-note’s guarded CLI.",
      "Integration notes",
    ),
    "The dashboard reads recent notes through Agent-note’s guarded CLI.",
  );
});

test("skips a generic Purpose label in favor of substantive prose", () => {
  assert.equal(
    legacySummaryFromNoteText(
      "# Dashboard handoff\n\nPurpose.\n\nKeep the local dashboard useful when a source is temporarily unavailable.",
      "Dashboard handoff",
    ),
    "Keep the local dashboard useful when a source is temporarily unavailable.",
  );
});

test("skips a generic conversation handoff label in favor of substantive prose", () => {
  assert.equal(
    legacySummaryFromNoteText(
      "# Session handoff\n\n## Conversation purpose and continuation.\n\nThe session connected recent Agent-note entries to the private dashboard.",
      "Session handoff",
    ),
    "The session connected recent Agent-note entries to the private dashboard.",
  );
});

test("uses Agent-note's saved summary instead of deriving a second preview", async () => {
  const calls = [];
  const runCli = async (args) => {
    calls.push(args);
    if (args[0] === "recent") {
      return [
        {
          path: "/private/notes/2026-07-28/12-00-00.md",
          date: "2026-07-28T12:00:00",
          title: "Dashboard bridge",
          tags: ["dashboard", "agent-note"],
          summary: "The saved summary is the one shown on the dashboard card.",
          text: "The dashboard uses Agent-note’s existing access safeguards.",
          truncated: false,
        },
      ];
    }
    return {
      path: args[2],
      summary: "The saved summary is the one shown on the dashboard card.",
      content: "---\ntitle: \"Dashboard bridge\"\n---\n\nFull note body.\n",
    };
  };

  const payload = await collectAgentNoteLibrary({ runCli });

  assert.deepEqual(calls, [
    ["recent", "--days", "7"],
    ["read", "--path", "/private/notes/2026-07-28/12-00-00.md"],
  ]);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].title, "Dashboard bridge");
  assert.deepEqual(payload.items[0].tags, ["dashboard", "agent-note"]);
  assert.equal(
    payload.items[0].summary,
    "The saved summary is the one shown on the dashboard card.",
  );
  assert.equal("preview" in payload.items[0], false);
  assert.match(payload.items[0].content, /Full note body/);
  assert.equal("path" in payload.items[0], false);
  assert.match(payload.items[0].id, /^[a-f0-9]{20}$/);
});

test("uses the body-derived fallback only when Agent-note has no summary", async () => {
  const payload = await collectAgentNoteLibrary({
    runCli: async (args) =>
      args[0] === "recent"
        ? [
            {
              path: "/private/notes/legacy.md",
              date: "2026-07-24T12:00:00",
              title: "Legacy dashboard note",
              tags: ["legacy"],
              text: "# Legacy dashboard note\n\nThe older note has no stored summary.",
              truncated: false,
            },
          ]
        : {
            path: args[2],
            content:
              "---\ntitle: \"Legacy dashboard note\"\n---\n\nThe older note has no stored summary.\n",
          },
  });

  assert.equal(
    payload.items[0].summary,
    "The older note has no stored summary.",
  );
});

test("returns a healthy empty list when no notes were saved this week", async () => {
  const payload = await collectAgentNoteLibrary({
    runCli: async () => [],
  });
  assert.deepEqual(payload, { items: [] });
});
