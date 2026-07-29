import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

const CLI_TIMEOUT_MS = 20_000;
const CLI_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const READ_CONCURRENCY = 4;
const PREVIEW_LENGTH = 190;
const GENERIC_PREVIEW_LINES = new Set([
  "purpose",
  "conversation purpose and continuation",
]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanPreviewLine(value) {
  return value
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentencePreview(value) {
  const sentence = value.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? value;
  if (sentence.length <= PREVIEW_LENGTH) {
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  }

  const clipped = sentence.slice(0, PREVIEW_LENGTH - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, Math.max(lastSpace, 80)).trim()}…`;
}

function isGenericPreviewLine(value) {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[.:!?]+$/, "")
    .trim();
  return GENERIC_PREVIEW_LINES.has(normalized);
}

export function legacySummaryFromNoteText(text, title) {
  const normalizedTitle = cleanText(title).toLocaleLowerCase();
  let inCodeFence = false;
  const lines = cleanText(text).split(/\r?\n/);

  for (const rawLine of lines) {
    if (/^\s*```/.test(rawLine)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence || !rawLine.trim()) continue;

    const line = cleanPreviewLine(rawLine);
    if (
      !line ||
      line.toLocaleLowerCase() === normalizedTitle ||
      isGenericPreviewLine(line)
    ) {
      continue;
    }
    return sentencePreview(line);
  }

  return `A saved note titled “${cleanText(title) || "Untitled note"}”.`;
}

function agentNoteProjectDirectory() {
  const configured = cleanText(process.env.AGENT_NOTE_PROJECT_DIR);
  return resolve(configured || resolve(process.cwd(), "..", "Agent-note"));
}

async function resolveCliInvocation(args) {
  const projectDirectory = agentNoteProjectDirectory();
  const configuredCli = cleanText(process.env.AGENT_NOTE_CLI_PATH);
  if (configuredCli) {
    if (!isAbsolute(configuredCli)) {
      throw new Error("AGENT_NOTE_CLI_PATH must be an absolute path");
    }
    await access(configuredCli, fsConstants.X_OK);
    return { command: configuredCli, args, cwd: projectDirectory };
  }

  const projectCli = resolve(projectDirectory, ".venv", "bin", "agent-note");
  try {
    await access(projectCli, fsConstants.X_OK);
    return { command: projectCli, args, cwd: projectDirectory };
  } catch {
    return {
      command: "uv",
      args: ["run", "--locked", "agent-note", ...args],
      cwd: projectDirectory,
    };
  }
}

export async function runAgentNoteCli(args) {
  const invocation = await resolveCliInvocation(args);
  return new Promise((resolveResult, rejectResult) => {
    execFile(
      invocation.command,
      invocation.args,
      {
        cwd: invocation.cwd,
        encoding: "utf8",
        maxBuffer: CLI_MAX_BUFFER_BYTES,
        timeout: CLI_TIMEOUT_MS,
      },
      (error, stdout) => {
        let payload;
        try {
          payload = JSON.parse(stdout);
        } catch {
          rejectResult(new Error("Agent-note returned invalid JSON"));
          return;
        }

        if (error || payload?.error) {
          rejectResult(
            new Error(cleanText(payload?.error) || "Agent-note is unavailable"),
          );
          return;
        }
        resolveResult(payload);
      },
    );
  });
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index]);
      } catch {
        results[index] = undefined;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(READ_CONCURRENCY, Math.max(items.length, 1)) },
      () => runWorker(),
    ),
  );
  return results;
}

function isRecentNote(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.path === "string" &&
    typeof value.date === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.text === "string" &&
    Number.isFinite(Date.parse(value.date))
  );
}

export async function collectAgentNoteLibrary({ runCli = runAgentNoteCli } = {}) {
  const recentPayload = await runCli(["recent", "--days", "7"]);
  if (!Array.isArray(recentPayload)) {
    throw new Error("Agent-note recent result was not a list");
  }

  const recentNotes = recentPayload.filter(isRecentNote);
  const notes = await mapWithConcurrency(recentNotes, async (note) => {
    const readPayload = await runCli(["read", "--path", note.path]);
    if (
      !readPayload ||
      typeof readPayload !== "object" ||
      typeof readPayload.content !== "string"
    ) {
      throw new Error("Agent-note read result did not include note content");
    }

    const storedSummary = cleanText(note.summary) || cleanText(readPayload.summary);

    return {
      id: createHash("sha256").update(note.path).digest("hex").slice(0, 20),
      title: cleanText(note.title) || "Untitled note",
      savedAt: new Date(note.date).toISOString(),
      tags: note.tags.map(cleanText).filter(Boolean),
      // A note's durable summary is the single source of truth for the card.
      // Only legacy notes without one retain the older local body fallback.
      summary:
        storedSummary || legacySummaryFromNoteText(note.text, note.title),
      content: readPayload.content,
    };
  });

  const availableNotes = notes.filter(Boolean);
  if (recentNotes.length && !availableNotes.length) {
    throw new Error("Agent-note could not read the recent notes");
  }

  return { items: availableNotes };
}
