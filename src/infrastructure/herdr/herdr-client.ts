import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  /** Best-effort live model (e.g. "Claude/Sonnet 5.5"); SQLite owns the assignment. */
  model: string | null;
  /** Best-effort live reasoning effort (e.g. "high", "medium"); falls back to SQLite tasks.effort when null. */
  effort: string | null;
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

type HerdrResponse = { result?: unknown; error?: { message?: string } };

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
    }, 10_000);

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
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Extracts live reasoning effort from agent tokens (quota_effort, effort, etc.).
 * If Herdr tokens do not contain an effort field, returns null and consumers fall
 * back to the stored tasks.effort from SQLite.
 */
function effortOf(tokens: unknown): string | null {
  if (!tokens || typeof tokens !== "object") return null;
  const record = tokens as Record<string, unknown>;
  const value = record.quota_effort ?? record.effort;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function topicOf(tokens: unknown): string | null {
  if (!tokens || typeof tokens !== "object") return null;
  const value = (tokens as Record<string, unknown>).quota_topic;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Adapter: Herdr socket + CLI. Reads prefer the socket (`session.snapshot`) so
 * the container needs no Herdr binary; the CLI is a fallback. `agent.prompt`
 * goes over the socket.
 */
export class HerdrClient implements HerdrPort {
  async snapshot(): Promise<HerdrSnapshot> {
    try {
      const response = await herdrRequest("session.snapshot");
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
    const response = await herdrRequest("agent.prompt", {
      target,
      text,
      wait: options?.until ? { until: options.until, timeout_ms: options.timeoutMs ?? null } : null,
    });
    if (response.error) {
      throw new Error(response.error.message ?? "herdr agent.prompt failed");
    }
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
