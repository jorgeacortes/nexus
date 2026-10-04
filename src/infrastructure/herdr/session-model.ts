import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import { normalizeEffort, normalizeModelId } from "@/domain/tasks/model";
import type { Harness } from "@/domain/tasks/task";

/**
 * The model a harness believes it is running, read from the harness's own state
 * instead of Herdr's status line. Herdr's `tokens.quota_*` is a display label: it
 * prefixes the provider (`opencode-go/deepseek-v4.1-flash`), uses display names
 * (`Claude/Sonnet 5.5` instead of the id `claude-sonnet-5-5`), is absent for some
 * panes, and for Cursor is outright wrong — both live Cursor panes carry Claude
 * quota tokens while their sessions run `grok-4.7`.
 *
 * Sources, all verified against the running machine (see AGENTS.md):
 *
 *   pi          Herdr `agent_session.value` is the session transcript path →
 *               first entries carry `modelId`/`provider`, then `thinkingLevel`.
 *   claude_code `agent_session.value` is the session id → `~/.claude/projects/
 *               <slug>/<id>.jsonl`, each assistant turn carries `message.model`
 *               and `effort`/`perTurnEffort`; `~/.claude/settings.json`
 *               (`modelSettings[model].effortLevel`) is the effort fallback.
 *   cursor      `agent_session.value` is the session id → `~/.cursor/chats/<hash>/
 *               <id>/store.db`, whose `meta` value is hex-encoded JSON with
 *               `lastUsedModel`; the effort is the per-model parameter Cursor
 *               records in `~/.cursor/cli-config.json`.
 *
 * Reads are bounded (head/tail slices, never a whole transcript) and cached by
 * file mtime+size, because the board polls the snapshot every 5s.
 */

/** Herdr's agent-session descriptor (`agent_session` in the snapshot). */
export type HarnessSession = {
  agent: string;
  kind: string;
  source: string;
  value: string;
} | null;

/** Where a resolved model came from — `session` is authoritative, `quota` a fallback. */
export type ObservedModelSource = "session" | "quota" | null;

export type ObservedModel = {
  model: string | null;
  effort: string | null;
  source: ObservedModelSource;
};

type SessionModel = { model: string | null; effort: string | null };

const EMPTY: SessionModel = { model: null, effort: null };

const HEAD_BYTES = 16 * 1024;
const TAIL_BYTES = 256 * 1024;

/**
 * Root of the harness state. In Docker the three agent directories are mounted
 * read-only under one root and `HARNESS_STATE_DIR=/harness`; on the host (dev,
 * CLI, tests) each harness uses its real home directory.
 */
function harnessDir(harness: Harness): string {
  const root = process.env.HARNESS_STATE_DIR?.trim();
  if (root) return join(root, HARNESS_STATE_SUBDIRS[harness]);
  if (harness === "pi") return join(homedir(), ".pi", "agent");
  if (harness === "claude_code") return join(homedir(), ".claude");
  if (harness === "cursor") return join(homedir(), ".cursor");
  return join(homedir(), `.${harness}`);
}

/** Directory names under `HARNESS_STATE_DIR`, mirroring the docker-compose mounts. */
const HARNESS_STATE_SUBDIRS: Record<Harness, string> = {
  pi: "pi",
  claude_code: "claude",
  cursor: "cursor",
  agy: "agy",
};

/**
 * Resolves the observed model for one pane: the harness's session state wins,
 * Herdr's normalised label is the fallback when the session cannot be read.
 * Best-effort throughout — any failure yields "unknown", never an exception.
 */
export async function resolveObservedModel(input: {
  harness: Harness | null;
  session: HarnessSession;
  /** Herdr's `quota_provider_model`/`quota_model`, already normalised. */
  quotaModel: string | null;
  /** Herdr's effort token, if one ever appears. */
  quotaEffort: string | null;
}): Promise<ObservedModel> {
  const quotaModel = normalizeModelId(input.quotaModel);
  const quotaEffort = normalizeEffort(input.quotaEffort);

  const session = input.harness && input.session ? await readSessionModel(input.harness, input.session) : EMPTY;
  if (session.model) {
    return { model: session.model, effort: session.effort ?? quotaEffort, source: "session" };
  }
  if (quotaModel) {
    return { model: quotaModel, effort: quotaEffort, source: "quota" };
  }
  return { model: null, effort: quotaEffort, source: null };
}

async function readSessionModel(harness: Harness, session: HarnessSession): Promise<SessionModel> {
  try {
    if (!session || session.value.trim() === "") return EMPTY;
    if (harness === "pi") return await readPiSession(session.value);
    if (harness === "claude_code") return await readClaudeSession(session.value);
    if (harness === "cursor") return await readCursorSession(session.value);
    // agy has no verified on-disk session store on this machine; it falls back
    // to the Herdr label.
    return EMPTY;
  } catch {
    return EMPTY;
  }
}

/* ------------------------------------------------------------------ pi ----- */

async function readPiSession(value: string): Promise<SessionModel> {
  const marker = "/sessions/";
  const index = value.indexOf(marker);
  if (index < 0) return EMPTY;
  const path = join(harnessDir("pi"), "sessions", value.slice(index + marker.length));
  if (!existsSync(path)) return EMPTY;
  return cachedRead(path, async () => {
    const head = await readHead(path, HEAD_BYTES);
    let model: string | null = null;
    let effort: string | null = null;
    for (const line of head.split("\n")) {
      const entry = parseJson(line);
      if (!entry) continue;
      if (!model && typeof entry.modelId === "string") model = normalizeModelId(entry.modelId);
      if (!effort && typeof entry.thinkingLevel === "string") effort = normalizeEffort(entry.thinkingLevel);
      if (model && effort) break;
    }
    return { model, effort };
  });
}

/* ---------------------------------------------------------- claude code ---- */

async function readClaudeSession(id: string): Promise<SessionModel> {
  const projectsDir = join(harnessDir("claude_code"), "projects");
  const path = findFileInDirs(projectsDir, `${id}.jsonl`);
  if (!path) return EMPTY;
  return cachedRead(path, async () => {
    const tail = await readTail(path, TAIL_BYTES);
    // The first line of the slice is almost certainly cut in half.
    const lines = tail.split("\n").slice(tail.startsWith("{") ? 0 : 1);
    let model: string | null = null;
    let effort: string | null = null;
    for (let index = lines.length - 1; index >= 0 && model === null; index -= 1) {
      const entry = parseJson(lines[index] ?? "");
      if (entry?.type !== "assistant") continue;
      const message = entry.message as Record<string, unknown> | undefined;
      if (typeof message?.model !== "string") continue;
      model = normalizeModelId(message.model);
      effort =
        normalizeEffort(entry.effort as string | undefined) ??
        normalizeEffort(entry.perTurnEffort as string | undefined);
    }
    return { model, effort: effort ?? readClaudeSettingsEffort(model) };
  });
}

/** `~/.claude/settings.json` remembers the effort the operator last chose per model. */
function readClaudeSettingsEffort(model: string | null): string | null {
  if (!model) return null;
  const path = join(harnessDir("claude_code"), "settings.json");
  if (!existsSync(path)) return null;
  try {
    const settings = JSON.parse(readTextFile(path)) as {
      modelSettings?: Record<string, { effortLevel?: string }>;
    };
    return normalizeEffort(settings.modelSettings?.[model]?.effortLevel);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- cursor ---- */

async function readCursorSession(id: string): Promise<SessionModel> {
  const chatsDir = join(harnessDir("cursor"), "chats");
  // Layout: `chats/<workspace-hash>/<session-id>/store.db`.
  const path = findFileInDirs(chatsDir, join(id, "store.db"));
  if (!path) return EMPTY;
  return cachedRead(path, async () => {
    const model = normalizeModelId(readCursorLastUsedModel(path));
    return { model, effort: readCursorEffort(model) };
  });
}

/**
 * Cursor stores the session metadata as a hex-encoded JSON blob in the `meta`
 * table of a per-session SQLite file. Read it with better-sqlite3 when the file
 * can be opened read-only, else fall back to scanning the raw bytes for the hex
 * of `"lastUsedModel":"` — inside the container the directory is mounted `:ro`
 * and SQLite cannot create the `-shm` sidecar a WAL database wants.
 */
function readCursorLastUsedModel(path: string): string | null {
  const viaSqlite = readCursorMetaValue(path);
  const raw = viaSqlite ?? scanCursorMetaHex(path);
  if (!raw) return null;
  try {
    const json = raw.trimStart().startsWith("{")
      ? (JSON.parse(raw) as { lastUsedModel?: string })
      : (JSON.parse(Buffer.from(raw, "hex").toString("utf8")) as { lastUsedModel?: string });
    return typeof json.lastUsedModel === "string" ? json.lastUsedModel : null;
  } catch {
    return null;
  }
}

function readCursorMetaValue(path: string): string | null {
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("select value from meta where key = ?").get("0") as { value?: unknown } | undefined;
      return typeof row?.value === "string" ? row.value : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

const CURSOR_MODEL_NEEDLE = Buffer.from('"lastUsedModel":"', "utf8").toString("hex");

function scanCursorMetaHex(path: string): string | null {
  try {
    const buffer = readFileSync(path) as Buffer;
    const start = buffer.indexOf(CURSOR_MODEL_NEEDLE, 0, "utf8");
    if (start < 0) return null;
    const valueStart = start + CURSOR_MODEL_NEEDLE.length;
    const end = buffer.indexOf("22", valueStart, "utf8"); // hex pair for `"`
    if (end < 0 || (end - valueStart) % 2 !== 0) return null;
    return buffer.subarray(valueStart, end).toString("utf8");
  } catch {
    return null;
  }
}

/** Cursor records the effort as a per-model parameter (`effort`/`reasoning_effort`). */
function readCursorEffort(model: string | null): string | null {
  if (!model) return null;
  const path = join(harnessDir("cursor"), "cli-config.json");
  if (!existsSync(path)) return null;
  try {
    const config = JSON.parse(readTextFile(path)) as {
      modelParameters?: Record<string, Array<{ id?: string; value?: string }>>;
      selectedModel?: { modelId?: string; parameters?: Array<{ id?: string; value?: string }> };
    };
    const parameters =
      config.modelParameters?.[model] ??
      (config.selectedModel?.modelId === model ? config.selectedModel.parameters : undefined);
    const effort = (parameters ?? []).find((entry) => entry.id === "effort" || entry.id === "reasoning_effort");
    return normalizeEffort(effort?.value);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- helpers ---- */

const cache = new Map<string, { key: string; value: SessionModel }>();

async function cachedRead(path: string, compute: () => Promise<SessionModel>): Promise<SessionModel> {
  let key: string;
  try {
    const stat = statSync(path);
    key = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return EMPTY;
  }
  const hit = cache.get(path);
  if (hit?.key === key) return hit.value;
  const value = await compute().catch(() => EMPTY);
  cache.set(path, { key, value });
  return value;
}

function parseJson(line: string | undefined): Record<string, unknown> | null {
  if (!line) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readHead(path: string, bytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const size = (await handle.stat()).size;
    const length = Math.min(bytes, size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readTail(path: string, bytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const size = (await handle.stat()).size;
    const length = Math.min(bytes, size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** First `dir/<sub>/<name>` that exists; the per-session lookups by id. */
function findFileInDirs(dir: string, name: string): string | null {
  for (const sub of readdirSafe(dir)) {
    const candidate = join(dir, sub, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readTextFile(path: string): string {
  return (readFileSync(path) as Buffer).toString("utf8");
}
