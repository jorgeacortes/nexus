/**
 * Which Nexus board an `nx` invocation talks to.
 *
 * Resolution order: `NEXUS_URL`, then the machine config (`~/.config/nexus/env`),
 * then a probe of the known local ports — the deployed container before the dev
 * server. The probe is what makes a bare `nx claim` work from an agent pane that
 * never had NEXUS_URL set. Because a probe is a guess, the chosen board is always
 * reported by the caller, and a probed board with no projects refuses writes
 * unless `--force`: that is the empty `./data-dev` trap this module exists to
 * close, not a convenience.
 */

import { readFileSync } from "node:fs";

import type { BoardInstance } from "./types";

export type BoardSource = "env" | "config" | "probe";

export type BoardTarget = {
  url: string;
  source: BoardSource;
  /** Every candidate that answered, in probe order; the first one is `url`. */
  reachable: string[];
  /** Board identity, or null when the board predates `/api/instance`. */
  instance: BoardInstance | null;
};

export type ProbeResult = { reachable: true; instance: BoardInstance | null } | { reachable: false };

/** Answers "is a Nexus board here?" — `instance` is null for a board with no `/api/instance`. */
export type Probe = (url: string) => Promise<ProbeResult>;

export type ReadFile = (path: string) => string | null;

/** The port `docker compose` publishes by default. */
const DEPLOYED_PORT = 3210;
/** The port `pnpm dev` listens on. */
const DEV_PORT = 3100;
/** A cold `pnpm dev` compiles the route on first hit, so allow for that; a refused port fails instantly. */
const PROBE_TIMEOUT_MS = 5000;

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** `$XDG_CONFIG_HOME/nexus/env`, or `~/.config/nexus/env`. */
export function configPath(env: NodeJS.Dict<string> = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || `${env.HOME?.trim() ?? ""}/.config`;
  return `${base}/nexus/env`;
}

/** `KEY=value` lines: `#` comments, optional `export`, optional surrounding quotes. */
export function parseConfig(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = assignment.indexOf("=");
    if (equals <= 0) continue;
    const key = assignment.slice(0, equals).trim();
    let value = assignment.slice(equals + 1).trim();
    const quoted =
      value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    if (key.length > 0) values[key] = value;
  }
  return values;
}

export function readConfigFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The pinned board URL from the machine config, if the file exists and sets one. */
export function configUrl(env: NodeJS.Dict<string> = process.env, read: ReadFile = readConfigFile): string | null {
  const text = read(configPath(env));
  if (text === null) return null;
  const url = parseConfig(text).NEXUS_URL?.trim();
  return url ? normalizeUrl(url) : null;
}

/**
 * The local ports probed when nothing is pinned: `NEXUS_CANDIDATES` verbatim when
 * set, otherwise the deployed container (respecting `HOST_PORT`) then the dev server.
 */
export function candidateUrls(env: NodeJS.Dict<string> = process.env): string[] {
  const configured = (env.NEXUS_CANDIDATES ?? "")
    .split(",")
    .map(normalizeUrl)
    .filter((url) => url.length > 0);
  if (configured.length > 0) return [...new Set(configured)];

  const hostPort = env.HOST_PORT?.trim();
  const urls = [
    ...(hostPort ? [`http://localhost:${hostPort}`] : []),
    `http://localhost:${DEPLOYED_PORT}`,
    `http://localhost:${DEV_PORT}`,
  ];
  return [...new Set(urls)];
}

/**
 * Resolves the board, or explains why it could not. An explicit URL that does not
 * answer is an error; the probe only reports when *nothing* answered.
 */
export async function resolveBoard(input: {
  probe: Probe;
  env?: NodeJS.Dict<string>;
  read?: ReadFile;
  candidates?: string[];
}): Promise<BoardTarget> {
  const env = input.env ?? process.env;

  const fromEnv = normalizeUrl(env.NEXUS_URL ?? "");
  if (fromEnv.length > 0) {
    return {
      url: fromEnv,
      source: "env",
      reachable: [],
      instance: await requireBoard(fromEnv, input.probe, "NEXUS_URL"),
    };
  }

  const fromConfig = configUrl(env, input.read ?? readConfigFile);
  if (fromConfig !== null) {
    const where = configPath(env);
    return {
      url: fromConfig,
      source: "config",
      reachable: [],
      instance: await requireBoard(fromConfig, input.probe, where),
    };
  }

  const candidates = input.candidates ?? candidateUrls(env);
  const answered: Array<{ url: string; instance: BoardInstance | null }> = [];
  for (const url of candidates) {
    const result = await input.probe(url);
    if (result.reachable) answered.push({ url, instance: result.instance });
  }
  if (answered.length === 0) {
    throw new Error(
      `no Nexus board answered at ${candidates.join(", ")} — start one (pnpm docker:up or pnpm dev) or set NEXUS_URL; \`nx doctor\` shows every candidate`,
    );
  }
  return {
    url: answered[0].url,
    source: "probe",
    reachable: answered.map((entry) => entry.url),
    instance: answered[0].instance,
  };
}

async function requireBoard(url: string, probe: Probe, source: string): Promise<BoardInstance | null> {
  const result = await probe(url);
  if (!result.reachable) {
    throw new Error(`cannot reach Nexus at ${url} (from ${source}) — \`nx doctor\` shows the boards that answer`);
  }
  return result.instance;
}

/** One line naming a board and what lives in it, for headers, notices and errors. */
export function describeInstance(instance: BoardInstance | null): string {
  if (instance === null) return "identity unknown (board has no /api/instance)";
  const location = instance.database ?? instance.dataDir ?? "database unknown";
  const tasks = instance.counts.tasks === null ? "tasks unknown" : `${instance.counts.tasks} tasks`;
  return `${location} · ${tasks} / ${instance.counts.projects} projects`;
}

export function describeTarget(target: BoardTarget): string {
  return `${target.url} · ${describeInstance(target.instance)}`;
}

async function getJson(url: string, path: string): Promise<{ ok: boolean; body: unknown }> {
  try {
    const response = await fetch(`${url}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, body: null };
    return { ok: true, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, body: null };
  }
}

function asInstance(body: unknown): BoardInstance | null {
  const data = (body as { data?: unknown } | null)?.data as
    | { dataDir?: unknown; database?: unknown; counts?: { projects?: unknown; tasks?: unknown } }
    | undefined;
  if (!data || typeof data.counts?.projects !== "number" || typeof data.counts?.tasks !== "number") return null;
  return {
    dataDir: typeof data.dataDir === "string" ? data.dataDir : null,
    database: typeof data.database === "string" ? data.database : null,
    counts: { projects: data.counts.projects, tasks: data.counts.tasks },
  };
}

function asProjectCount(body: unknown): number | null {
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data.length : null;
}

/**
 * The real probe: `/api/instance` for identity, `/api/projects` as the fallback a
 * board built before that route still answers.
 */
export async function probeHttp(url: string): Promise<ProbeResult> {
  const instance = await getJson(url, "/api/instance");
  if (instance.ok) {
    const parsed = asInstance(instance.body);
    if (parsed !== null) return { reachable: true, instance: parsed };
  }

  const projects = await getJson(url, "/api/projects");
  if (!projects.ok) return { reachable: false };
  const count = asProjectCount(projects.body);
  if (count === null) return { reachable: false };
  return { reachable: true, instance: { dataDir: null, database: null, counts: { projects: count, tasks: null } } };
}
