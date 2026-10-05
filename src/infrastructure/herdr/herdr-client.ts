import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  HarnessPane,
  HarnessPort,
  HarnessProcess,
  HarnessTab,
  HarnessTabCreated,
  HarnessWorkspace,
} from "@/domain/dispatch/harness";
import { normalizeEffort, normalizeModelId } from "@/domain/tasks/model";
import { harnessFromAgentKind } from "@/domain/tasks/task";
import { type HarnessSession, resolveObservedModel } from "@/infrastructure/herdr/session-model";

export type HerdrAgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/** Live agent/pane state as reported by the Herdr session snapshot. */
export interface HerdrAgentState {
  agent: string;
  agentStatus: HerdrAgentStatus;
  paneId: string;
  tabId: string;
  workspaceId: string;
  workspaceLabel: string;
  tabLabel: string;
  cwd: string;
  terminalTitle: string;
  /** Best-effort live model, canonical id (e.g. "claude-sonnet-5-5"); SQLite owns the assignment. */
  model: string | null;
  /** Best-effort live reasoning effort (e.g. "high", "medium"); falls back to SQLite tasks.effort when null. */
  effort: string | null;
  /**
   * The harness's own session descriptor (transcript path or session id). Nexus
   * reads it to establish the model the session is really running, instead of
   * trusting Herdr's display label.
   */
  session: HarnessSession;
  /** Herdr's current topic for the agent (its last line of conversation). */
  topic: string | null;
  focused: boolean;
}

export interface HerdrWorkspaceState {
  workspaceId: string;
  label: string;
  agentStatus: string;
  tabCount: number;
  paneCount: number;
}

export interface HerdrTabState {
  tabId: string;
  workspaceId: string;
  label: string;
  agentStatus: string;
}

export interface HerdrSnapshot {
  agents: HerdrAgentState[];
  workspaces: HerdrWorkspaceState[];
  tabs: HerdrTabState[];
  focusedWorkspaceId: string | null;
  focusedTabId: string | null;
  focusedPaneId: string | null;
}

/** Port: how Nexus talks to Herdr. Adapters implement this; domain code never touches sockets. */
export interface HerdrPort {
  /** Returns the live session snapshot (agents, panes, tabs, workspaces). */
  snapshot(): Promise<HerdrSnapshot>;
  /** Sends a prompt to an agent. `target` is a pane id or other agent target. */
  prompt(target: string, text: string, options?: { timeoutMs?: number; until?: string[] }): Promise<void>;
}

type HerdrResponse = { result?: unknown; error?: { code?: string; message?: string } };

/** A JSON-RPC error from Herdr, carrying its machine-readable `code`. */
export class HerdrApiError extends Error {
  constructor(
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "HerdrApiError";
  }
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** True while Herdr still reports a freshly created pane as not an available shell. */
function isPaneUnavailable(error: unknown): boolean {
  if (error instanceof HerdrApiError) {
    return error.code === "agent_pane_busy" || error.code === "agent_pane_unavailable";
  }
  return error instanceof Error && /not an available shell/i.test(error.message);
}

/**
 * One JSON-RPC round-trip against the Herdr socket. Injectable so the topology
 * adapter can be tested for the exact method/params it sends without a socket
 * (production passes `herdrRequest`).
 */
export type HerdrRequestFn = (method: string, params?: Record<string, unknown>) => Promise<HerdrResponse>;

type RawSnapshot = {
  agents?: Array<Record<string, unknown>>;
  workspaces?: Array<Record<string, unknown>>;
  tabs?: Array<Record<string, unknown>>;
  focused_workspace_id?: unknown;
  focused_tab_id?: unknown;
  focused_pane_id?: unknown;
};

/**
 * Where the Herdr JSON-RPC socket lives. `HERDR_SOCKET` (explicit override) wins,
 * then Herdr's own `HERDR_SOCKET_PATH`, then the default config location. The
 * Docker image mounts `~/.config/herdr` and sets `HERDR_SOCKET` at it.
 */
export function resolveHerdrSocketPath(env: NodeJS.Dict<string> = process.env): string {
  const configured = env.HERDR_SOCKET?.trim() || env.HERDR_SOCKET_PATH?.trim();
  if (configured) return configured;
  const candidates = [join(homedir(), ".config", "herdr", "herdr.sock"), join(homedir(), ".herdr", "herdr.sock")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/** Runs a request against the Herdr API socket and returns the parsed response. */
export async function herdrRequest(
  method: string,
  params?: Record<string, unknown>,
  env: NodeJS.Dict<string> = process.env,
  timeoutMs = 10_000,
): Promise<HerdrResponse> {
  const { default: net } = await import("node:net");
  const socketPath = resolveHerdrSocketPath(env);
  const payload = JSON.stringify({ id: `nexus:${method}:${Date.now()}`, method, params: params ?? {} });

  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`herdr socket timeout: ${method}`));
    }, timeoutMs);

    socket.on("connect", () => socket.end(`${payload}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
    });
    socket.on("end", () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(buffer) as HerdrResponse);
      } catch (error) {
        reject(new Error(`herdr: invalid response: ${error instanceof Error ? error.message : "unknown"}`));
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/** Maps the raw snapshot JSON into the shapes Nexus needs. */
export function parseSnapshot(raw: RawSnapshot): HerdrSnapshot {
  const workspaces: HerdrWorkspaceState[] = (raw.workspaces ?? []).map((workspace) => ({
    workspaceId: String(workspace.workspace_id ?? ""),
    label: String(workspace.label ?? ""),
    agentStatus: String(workspace.agent_status ?? "unknown"),
    tabCount: Number(workspace.tab_count ?? 0),
    paneCount: Number(workspace.pane_count ?? 0),
  }));

  const tabs: HerdrTabState[] = (raw.tabs ?? []).map((tab) => ({
    tabId: String(tab.tab_id ?? ""),
    workspaceId: String(tab.workspace_id ?? ""),
    label: String(tab.label ?? ""),
    agentStatus: String(tab.agent_status ?? "unknown"),
  }));

  const workspaceLabels = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace.label]));
  const tabLabels = new Map(tabs.map((tab) => [tab.tabId, tab.label]));

  const agents: HerdrAgentState[] = (raw.agents ?? []).map((agent) => {
    const workspaceId = String(agent.workspace_id ?? "");
    const tabId = String(agent.tab_id ?? "");
    return {
      agent: String(agent.agent ?? "unknown"),
      agentStatus: normalizeStatus(agent.agent_status),
      paneId: String(agent.pane_id ?? ""),
      tabId,
      workspaceId,
      workspaceLabel: workspaceLabels.get(workspaceId) ?? "",
      tabLabel: tabLabels.get(tabId) ?? "",
      cwd: String(agent.cwd ?? ""),
      terminalTitle: String(agent.terminal_title_stripped ?? agent.terminal_title ?? ""),
      model: modelOf(agent.tokens),
      effort: effortOf(agent.tokens),
      session: sessionOf(agent.agent_session),
      topic: topicOf(agent.tokens),
      focused: Boolean(agent.focused),
    };
  });

  return {
    agents,
    workspaces,
    tabs,
    focusedWorkspaceId: stringOrNull(raw.focused_workspace_id),
    focusedTabId: stringOrNull(raw.focused_tab_id),
    focusedPaneId: stringOrNull(raw.focused_pane_id),
  };
}

function normalizeStatus(value: unknown): HerdrAgentStatus {
  const status = String(value ?? "unknown");
  return status === "idle" || status === "working" || status === "blocked" || status === "done" ? status : "unknown";
}

function modelOf(tokens: unknown): string | null {
  if (!tokens || typeof tokens !== "object") return null;
  const record = tokens as Record<string, unknown>;
  const value = record.quota_provider_model ?? record.quota_model;
  return normalizeModelId(typeof value === "string" ? value : null);
}

/** Herdr's `agent_session` descriptor: how to find the harness's own session state. */
function sessionOf(value: unknown): HarnessSession {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sessionValue = typeof record.value === "string" ? record.value : null;
  if (!sessionValue) return null;
  return {
    agent: String(record.agent ?? ""),
    kind: String(record.kind ?? ""),
    source: String(record.source ?? ""),
    value: sessionValue,
  };
}

/**
 * Extracts live reasoning effort from agent tokens (quota_effort, effort, etc.).
 * Herdr tokens carry no effort today; when they do not, the adapter falls back to
 * the effort the harness's own session state records (pi's `thinkingLevel`,
 * Claude Code's `effort`, Cursor's per-model parameter).
 */
function effortOf(tokens: unknown): string | null {
  if (!tokens || typeof tokens !== "object") return null;
  const record = tokens as Record<string, unknown>;
  const value = record.quota_effort ?? record.effort;
  return normalizeEffort(typeof value === "string" ? value : null);
}

function topicOf(tokens: unknown): string | null {
  if (!tokens || typeof tokens !== "object") return null;
  const value = (tokens as Record<string, unknown>).quota_topic;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function countOf(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

function statusOf(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "unknown";
}

/** Maps the `workspace_*` / `tab_*` / `pane_*` JSON into the dispatch port's shapes. */
function toWorkspace(raw: Record<string, unknown>): HarnessWorkspace {
  return {
    workspaceId: String(raw.workspace_id ?? ""),
    label: String(raw.label ?? ""),
    focused: Boolean(raw.focused),
    tabCount: countOf(raw.tab_count),
    paneCount: countOf(raw.pane_count),
    agentStatus: statusOf(raw.agent_status),
    activeTabId: stringOrNull(raw.active_tab_id),
  };
}

function toTab(raw: Record<string, unknown>): HarnessTab {
  return {
    tabId: String(raw.tab_id ?? ""),
    workspaceId: String(raw.workspace_id ?? ""),
    label: String(raw.label ?? ""),
    focused: Boolean(raw.focused),
    paneCount: countOf(raw.pane_count),
    agentStatus: statusOf(raw.agent_status),
  };
}

function toPane(raw: Record<string, unknown>): HarnessPane {
  return {
    paneId: String(raw.pane_id ?? ""),
    tabId: String(raw.tab_id ?? ""),
    workspaceId: String(raw.workspace_id ?? ""),
    agent: stringOrNull(raw.agent),
    agentStatus: statusOf(raw.agent_status),
    cwd: stringOrNull(raw.cwd),
    focused: Boolean(raw.focused),
    terminalTitle: String(raw.terminal_title_stripped ?? raw.terminal_title ?? ""),
  };
}

function toProcess(raw: Record<string, unknown>): HarnessProcess {
  return {
    pid: countOf(raw.pid),
    name: String(raw.name ?? ""),
    cmdline: stringOrNull(raw.cmdline),
    cwd: stringOrNull(raw.cwd),
  };
}

function resultRecord(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
}

function recordsOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/**
 * Adapter: Herdr socket + CLI. Reads prefer the socket (`session.snapshot`) so
 * the container needs no Herdr binary; the CLI is a fallback. `agent.prompt`
 * goes over the socket. The topology methods (`HarnessPort`) always go over the
 * socket, so `nx dispatch` needs no Herdr binary either.
 */
export class HerdrClient implements HerdrPort, HarnessPort {
  /**
   * `request` defaults to the real socket round-trip; tests inject a fake to
   * assert the exact method/params the topology adapter sends.
   */
  constructor(private readonly request: HerdrRequestFn = (method, params) => herdrRequest(method, params)) {}

  async snapshot(): Promise<HerdrSnapshot> {
    return hydrate(await this.readSnapshot());
  }

  /**
   * Enriches the parsed snapshot with the model each pane's own harness session
   * reports (see `session-model.ts`). Herdr's label is only a fallback, so the
   * resolved value is what the board, the claim, and `nx task show` all see.
   */
  private async readSnapshot(): Promise<HerdrSnapshot> {
    try {
      const response = await this.request("session.snapshot");
      if (response.error) {
        throw new Error(response.error.message ?? "herdr session.snapshot failed");
      }
      // Both the socket and the CLI wrap the snapshot: `result.snapshot`.
      const payload = (response.result as { snapshot?: RawSnapshot } | undefined)?.snapshot ?? {};
      return parseSnapshot(payload);
    } catch (socketError) {
      const raw = await this.runCli(["api", "snapshot"]).catch(() => {
        throw socketError instanceof Error ? socketError : new Error("herdr snapshot failed");
      });
      const payload = (raw as { result?: { snapshot?: unknown } }).result?.snapshot ?? {};
      return parseSnapshot(payload as RawSnapshot);
    }
  }

  async prompt(target: string, text: string, options?: { timeoutMs?: number; until?: string[] }): Promise<void> {
    const response = await this.request("agent.prompt", {
      target,
      text,
      wait: options?.until ? { until: options.until, timeout_ms: options.timeoutMs ?? null } : null,
    });
    if (response.error) {
      throw new Error(response.error.message ?? "herdr agent.prompt failed");
    }
  }

  // --- HarnessPort: Herdr topology (dispatch context) ---

  async listWorkspaces(): Promise<HarnessWorkspace[]> {
    const result = resultRecord(await this.call("workspace.list"));
    return recordsOf(result.workspaces).map(toWorkspace);
  }

  async listTabs(workspaceId: string): Promise<HarnessTab[]> {
    const result = resultRecord(await this.call("tab.list", { workspace_id: workspaceId }));
    return recordsOf(result.tabs).map(toTab);
  }

  async listPanes(workspaceId: string): Promise<HarnessPane[]> {
    const result = resultRecord(await this.call("pane.list", { workspace_id: workspaceId }));
    return recordsOf(result.panes).map(toPane);
  }

  /** `tab.get` for the close guard; a `tab_not_found` error is `null`, not a throw. */
  async getTab(tabId: string): Promise<HarnessTab | null> {
    try {
      const result = resultRecord(await this.call("tab.get", { tab_id: tabId }));
      const tab = resultRecord(result.tab);
      return Object.keys(tab).length === 0 ? null : toTab(tab);
    } catch (error) {
      if (error instanceof HerdrApiError && error.code === "tab_not_found") {
        return null;
      }
      throw error;
    }
  }

  async processes(paneId: string): Promise<HarnessProcess[]> {
    const result = resultRecord(await this.call("pane.process_info", { pane_id: paneId }));
    const info = resultRecord(result.process_info);
    const shellPid = typeof info.shell_pid === "number" ? info.shell_pid : null;
    return (
      recordsOf(info.foreground_processes)
        .map(toProcess)
        // The shell is the foreground process at its own prompt, which is a bare
        // prompt, not work (`shell_pid`). With no `shell_pid` to compare against,
        // every process is kept, so the guard fails safe.
        .filter((process) => shellPid === null || process.pid !== shellPid)
    );
  }

  async createWorkspace(label: string, cwd: string | null): Promise<HarnessWorkspace> {
    const result = resultRecord(await this.call("workspace.create", { label, cwd, focus: false }));
    return toWorkspace(resultRecord(result.workspace));
  }

  async createTab(workspaceId: string, label: string, cwd: string | null): Promise<HarnessTabCreated> {
    const result = resultRecord(await this.call("tab.create", { workspace_id: workspaceId, label, cwd, focus: false }));
    return { tab: toTab(resultRecord(result.tab)), rootPane: toPane(resultRecord(result.root_pane)) };
  }

  /**
   * Starts an agent in an existing shell pane and waits until Herdr considers it
   * interactive.
   *
   * Herdr's `agent.start` is two races in one: the freshly created pane is not yet
   * an available shell (so `agent.start` can fail with `agent_pane_busy`), and the
   * response returns as soon as the process is spawned — an agent that is not yet
   * *interactive* is "not an active named agent", so an immediate `agent.prompt`
   * is rejected. This mirrors the `herdr agent start` CLI: retry the start while
   * the pane is unavailable, then poll `agent.get` until it reports
   * `interactive_ready`, both bounded by `timeoutMs`.
   *
   * Deliberately no `timeout_ms` parameter: passing it to the socket method leaves
   * the agent `launch_pending` forever (verified against protocol 22), while the
   * omitted default completes readiness in a couple of seconds.
   */
  async startAgent(name: string, kind: string, paneId: string, options?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      try {
        await this.call("agent.start", { name, kind, pane_id: paneId });
        break;
      } catch (error) {
        if (!isPaneUnavailable(error) || Date.now() >= deadline) {
          throw error;
        }
        await sleep(250);
      }
    }

    while (Date.now() < deadline) {
      if (await this.isAgentInteractive(name)) return;
      await sleep(250);
    }
    throw new Error(`herdr agent.start: agent ${name} did not become interactive within ${timeoutMs}ms`);
  }

  async closeTab(tabId: string): Promise<void> {
    await this.call("tab.close", { tab_id: tabId });
  }

  /** Whether Herdr reports the named agent as interactive and ready for a prompt. */
  private async isAgentInteractive(name: string): Promise<boolean> {
    try {
      const result = resultRecord(await this.call("agent.get", { target: name }));
      return resultRecord(result.agent).interactive_ready === true;
    } catch {
      // Not an agent yet (or transiently gone): keep waiting until the deadline.
      return false;
    }
  }

  /** One JSON-RPC request, unwrapped and error-checked. */
  private async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await this.request(method, params);
    if (response.error) {
      throw new HerdrApiError(response.error.code, response.error.message ?? `herdr ${method} failed`);
    }
    return response.result;
  }

  private runCli(args: string[]): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const child = spawn("herdr", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`herdr ${args.join(" ")} exited with ${code}: ${stderr.trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as Record<string, unknown>);
        } catch {
          reject(new Error(`herdr ${args.join(" ")} returned invalid JSON`));
        }
      });
      child.on("error", reject);
    });
  }
}

/** Resolves each agent's observed model from its harness's own session state. */
async function hydrate(snapshot: HerdrSnapshot): Promise<HerdrSnapshot> {
  const agents = await Promise.all(
    snapshot.agents.map(async (agent) => {
      const observed = await resolveObservedModel({
        harness: harnessFromAgentKind(agent.agent),
        session: agent.session,
        quotaModel: agent.model,
        quotaEffort: agent.effort,
      });
      return { ...agent, model: observed.model, effort: observed.effort };
    }),
  );
  return { ...snapshot, agents };
}
