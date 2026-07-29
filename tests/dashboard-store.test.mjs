import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLibraryNotes } from "../app/data/dashboard-merge.ts";

test("migrates an existing cached library preview to summary", () => {
  const normalized = normalizeLibraryNotes([
    {
      id: "legacy-note",
      title: "Legacy cached note",
      savedAt: "2026-07-24T12:00:00.000Z",
      tags: ["agent-note"],
      preview: "The old local cache stored this text as a preview.",
      content: "---\ntitle: \"Legacy cached note\"\n---\n\nBody\n",
    },
  ]);

  assert.equal(
    normalized[0].summary,
    "The old local cache stored this text as a preview.",
  );
  assert.equal("preview" in normalized[0], false);
});
