import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const RECENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_NOTE_BYTES = 16 * 1024 * 1024;
const PREVIEW_LENGTH = 190;
const GENERIC_PREVIEW_LINES = new Set([
  "purpose",
  "conversation purpose and continuation",
]);
const DAY_DIRECTORY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENT_NOTE_STEM = /^(\d{2})-(\d{2})-(\d{2})(?:-\d+)?$/;
const LEGACY_NOTE_NAME =
  /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/;

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

export function configuredNotesFolder(
  configured = process.env.DASHBOARD_NOTES_FOLDER,
  homeDirectory = homedir(),
) {
  const value = cleanText(configured);
  if (!value) return resolve(homeDirectory, ".notes");
  if (!isAbsolute(value)) {
    throw new Error("DASHBOARD_NOTES_FOLDER must be an absolute path");
  }
  return resolve(value);
}

function isWithinRoot(root, candidate) {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !isAbsolute(fromRoot))
  );
}

function parseFrontmatterValue(value) {
  const clean = value.trim();
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("[") && clean.endsWith("]"))
  ) {
    try {
      return JSON.parse(clean);
    } catch {
      if (clean.startsWith('"')) return clean.slice(1, -1);
    }
  }
  return clean;
}

export function parseNoteDocument(text) {
  const parseable = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const lines = parseable.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { metadata: {}, body: parseable };
  }

  const metadata = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") {
      return {
        metadata,
        body: lines.slice(index + 1).join("\n").replace(/^\n+/, ""),
      };
    }
    const separator = line.indexOf(":");
    if (separator < 1) return { metadata: {}, body: parseable };
    const key = line.slice(0, separator).trim();
    if (!key) return { metadata: {}, body: parseable };
    metadata[key] = parseFrontmatterValue(line.slice(separator + 1));
  }
  return { metadata: {}, body: parseable };
}

function normalizeTag(value) {
  if (typeof value !== "string") return "";
  return value
    .toLocaleLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/g, "");
}

function storedTags(metadata) {
  let values = metadata.tags;
  if (typeof values === "string") {
    values = values
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((value) => value.replace(/^["']|["']$/g, "").trim());
  }
  if (!Array.isArray(values)) values = [];
  if (typeof metadata.category === "string") {
    values = [...values, metadata.category];
  }
  return [...new Set(values.map(normalizeTag).filter(Boolean))].slice(0, 8);
}

function pathDate(filePath) {
  const dayDirectory = basename(dirname(filePath));
  const currentMatch = basename(filePath, extname(filePath)).match(
    CURRENT_NOTE_STEM,
  );
  if (DAY_DIRECTORY.test(dayDirectory) && currentMatch) {
    const [year, month, day] = dayDirectory.split("-");
    const [, hour, minute, second] = currentMatch;
    const value = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
    if (Number.isFinite(value.getTime())) return value;
  }

  const legacyMatch = filePath
    .slice(filePath.lastIndexOf(sep) + 1)
    .match(LEGACY_NOTE_NAME);
  if (legacyMatch) {
    const [, year, month, day, hour, minute, second] = legacyMatch;
    const value = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
    if (Number.isFinite(value.getTime())) return value;
  }
  return undefined;
}

function noteDate(filePath, metadata, modifiedAt) {
  const stored = cleanText(metadata.date);
  if (stored) {
    const value = new Date(stored);
    if (Number.isFinite(value.getTime())) return value;
  }
  return pathDate(filePath) ?? modifiedAt;
}

async function markdownPaths(root, directory = root) {
  let canonicalDirectory;
  let entries;
  try {
    canonicalDirectory = await realpath(directory);
    entries = await readdir(canonicalDirectory, { withFileTypes: true });
  } catch (error) {
    if (directory === root) throw error;
    return [];
  }
  if (!isWithinRoot(root, canonicalDirectory)) return [];

  entries.sort((left, right) => left.name.localeCompare(right.name));
  const paths = [];
  for (const entry of entries) {
    // Hidden folders contain source material or application state, not normal
    // notes. Symlinks are skipped even when they happen to point back inside.
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const candidate = resolve(canonicalDirectory, entry.name);
    if (entry.isDirectory()) {
      try {
        paths.push(...(await markdownPaths(root, candidate)));
      } catch {
        // One unreadable nested directory must not hide other normal notes.
      }
      continue;
    }
    if (!entry.isFile() || extname(entry.name).toLocaleLowerCase() !== ".md") {
      continue;
    }
    try {
      const canonicalFile = await realpath(candidate);
      if (!isWithinRoot(root, canonicalFile)) continue;
      const details = await stat(canonicalFile);
      if (!details.isFile() || details.size > MAX_NOTE_BYTES) continue;
      paths.push({ path: canonicalFile, details });
    } catch {
      // Skip files that disappear or become unreadable during collection.
    }
  }
  return paths;
}

async function readNormalNote(entry, cutoff) {
  try {
    const buffer = await readFile(entry.path);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const { metadata, body } = parseNoteDocument(content);
    const savedAt = noteDate(entry.path, metadata, entry.details.mtime);
    if (savedAt < cutoff) return undefined;

    return {
      id: createHash("sha256").update(entry.path).digest("hex").slice(0, 20),
      title: cleanText(metadata.title) || basename(entry.path, extname(entry.path)),
      savedAt: savedAt.toISOString(),
      tags: storedTags(metadata),
      summary:
        cleanText(metadata.summary) ||
        legacySummaryFromNoteText(body, metadata.title),
      content,
    };
  } catch {
    return undefined;
  }
}

export async function collectLocalNotesLibrary({
  notesFolder = configuredNotesFolder(),
  now = new Date(),
} = {}) {
  if (!isAbsolute(notesFolder)) {
    throw new Error("The dashboard notes folder must be an absolute path");
  }
  const root = await realpath(notesFolder);
  const rootDetails = await stat(root);
  if (!rootDetails.isDirectory()) {
    throw new Error("The dashboard notes folder must be a directory");
  }

  const cutoff = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  const entries = await markdownPaths(root);
  const notes = (
    await Promise.all(entries.map((entry) => readNormalNote(entry, cutoff)))
  )
    .filter(Boolean)
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt));

  return { items: notes };
}
