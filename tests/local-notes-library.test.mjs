import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  collectLocalNotesLibrary,
  configuredNotesFolder,
  legacySummaryFromNoteText,
} from "../scripts/local-notes-library.mjs";

async function withTemporaryNotes(run) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-notes-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("builds a legacy body fallback without a model", () => {
  assert.equal(
    legacySummaryFromNoteText(
      "# Integration notes\n\n- The dashboard reads recent notes directly from its configured folder.",
      "Integration notes",
    ),
    "The dashboard reads recent notes directly from its configured folder.",
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
      "# Session handoff\n\n## Conversation purpose and continuation.\n\nThe session connected recent local notes to the private dashboard.",
      "Session handoff",
    ),
    "The session connected recent local notes to the private dashboard.",
  );
});

test("defaults to the shared plain-Markdown convention and requires an absolute override", () => {
  assert.equal(
    configuredNotesFolder(undefined, "/private/example-home"),
    "/private/example-home/.notes",
  );
  assert.throws(
    () => configuredNotesFolder("../notes", "/private/example-home"),
    /absolute path/,
  );
});

test("reads recent normal Markdown notes and preserves stored metadata and full content", async () => {
  await withTemporaryNotes(async (directory) => {
    const root = join(directory, "notes");
    const recentDirectory = join(root, "2026-07-29");
    await mkdir(recentDirectory, { recursive: true });
    const content = [
      "---",
      'title: "Dashboard bridge"',
      "date: 2026-07-29T12:00:00.000Z",
      'tags: ["Dashboard", "local_notes"]',
      'summary: "The saved summary is the one shown on the dashboard card."',
      "---",
      "",
      "Full note body.",
      "",
    ].join("\n");
    await writeFile(join(recentDirectory, "12-00-00.md"), content);

    const payload = await collectLocalNotesLibrary({
      notesFolder: root,
      now: new Date("2026-07-30T12:00:00.000Z"),
    });

    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].title, "Dashboard bridge");
    assert.equal(payload.items[0].savedAt, "2026-07-29T12:00:00.000Z");
    assert.deepEqual(payload.items[0].tags, ["dashboard", "local-notes"]);
    assert.equal(
      payload.items[0].summary,
      "The saved summary is the one shown on the dashboard card.",
    );
    assert.equal(payload.items[0].content, content);
    assert.equal("preview" in payload.items[0], false);
    assert.equal("path" in payload.items[0], false);
    assert.match(payload.items[0].id, /^[a-f0-9]{20}$/);
  });
});

test("uses the local body fallback only when a legacy note has no summary", async () => {
  await withTemporaryNotes(async (root) => {
    const noteDirectory = join(root, "2026-07-29");
    await mkdir(noteDirectory);
    await writeFile(
      join(noteDirectory, "12-00-00.md"),
      [
        "---",
        'title: "Legacy dashboard note"',
        "date: 2026-07-29T12:00:00.000Z",
        'tags: ["legacy"]',
        "---",
        "",
        "# Legacy dashboard note",
        "",
        "The older note has no stored summary.",
        "",
      ].join("\n"),
    );

    const payload = await collectLocalNotesLibrary({
      notesFolder: root,
      now: new Date("2026-07-30T12:00:00.000Z"),
    });
    assert.equal(
      payload.items[0].summary,
      "The older note has no stored summary.",
    );
  });
});

test("excludes old notes, hidden raw sources, non-Markdown files, and symlinks", async () => {
  await withTemporaryNotes(async (directory) => {
    const root = join(directory, "notes");
    const recentDirectory = join(root, "2026-07-29");
    const rawDirectory = join(root, ".raw", "conversations");
    const privateStateDirectory = join(root, ".private");
    await Promise.all([
      mkdir(recentDirectory, { recursive: true }),
      mkdir(rawDirectory, { recursive: true }),
      mkdir(privateStateDirectory, { recursive: true }),
    ]);

    const recentNote = (title, date = "2026-07-29T12:00:00.000Z") =>
      `---\ntitle: "${title}"\ndate: ${date}\n---\n\n${title} body.\n`;
    await Promise.all([
      writeFile(
        join(recentDirectory, "12-00-00.md"),
        recentNote("Visible note"),
      ),
      writeFile(
        join(recentDirectory, "11-00-00.md"),
        recentNote("Old note", "2026-07-20T11:00:00.000Z"),
      ),
      writeFile(join(rawDirectory, "raw.md"), recentNote("Raw source")),
      writeFile(join(root, ".hidden.md"), recentNote("Hidden file")),
      writeFile(
        join(privateStateDirectory, "state.md"),
        recentNote("Hidden state"),
      ),
      writeFile(
        join(recentDirectory, "not-a-note.txt"),
        recentNote("Text source"),
      ),
    ]);

    const outside = join(directory, "outside.md");
    await writeFile(outside, recentNote("Outside source"));
    await symlink(outside, join(recentDirectory, "linked.md"));

    const payload = await collectLocalNotesLibrary({
      notesFolder: root,
      now: new Date("2026-07-30T12:00:00.000Z"),
    });
    assert.deepEqual(
      payload.items.map((note) => note.title),
      ["Visible note"],
    );
  });
});

test("returns a healthy empty list when no notes were saved this week", async () => {
  await withTemporaryNotes(async (root) => {
    const payload = await collectLocalNotesLibrary({
      notesFolder: root,
      now: new Date("2026-07-30T12:00:00.000Z"),
    });
    assert.deepEqual(payload, { items: [] });
  });
});
