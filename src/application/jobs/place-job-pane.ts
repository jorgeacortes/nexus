import { EnsureWorkspaceUseCase } from "@/application/dispatch/ensure-workspace";
import type { HarnessPort } from "@/domain/dispatch/harness";
import {
  agentKindForHarness,
  agentNameForTask,
  choosePlacement,
  expandHome,
  taskTabLabel,
} from "@/domain/dispatch/placement";
import type { Job } from "@/domain/jobs/job";

/**
 * A spawn that reached a pane and then failed. `paneId` is set once the tab or
 * reused shell exists, including when `startAgent` times out, so the run row
 * can name the pane it touched.
 */
export class JobPaneError extends Error {
  readonly paneId: string | null;
  readonly timeout: boolean;

  constructor(message: string, paneId: string | null, timeout: boolean) {
    super(message);
    this.name = "JobPaneError";
    this.paneId = paneId;
    this.timeout = timeout;
  }
}

export type PlaceJobPaneInput = {
  harness: HarnessPort;
  job: Job;
  project: {
    id: string;
    name: string;
    folderPath: string;
    herdrWorkspaceId?: string | null;
  };
  setWorkspaceId: (projectId: string, workspaceId: string) => Promise<void>;
  /** Bound for `startAgent`'s readiness wait. The same budget the prompt uses. */
  timeoutMs: number;
};

/**
 * Herdr's caller timeout (`error.code`) and the readiness wait `startAgent`
 * already implements. A message of "timeout" is what `agent.prompt --wait`
 * returns when the caller deadline wins.
 */
export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "timeout") return true;
  if (!(error instanceof Error)) return false;
  return /did not become interactive within/i.test(error.message) || /\btimeout\b/i.test(error.message);
}

/**
 * Place an agent for a spawn run using the dispatch topology: the project's
 * workspace, then a bare shell already in that folder, otherwise a new tab
 * whose cwd is the project folder. Never a pane that sits somewhere else.
 * Starts the agent and returns the pane id. A start that misses its readiness
 * deadline throws `JobPaneError` with `timeout` set, and still names the pane.
 */
export async function placeJobPane(input: PlaceJobPaneInput): Promise<string> {
  const folder = expandHome(input.project.folderPath);
  const ensured = await new EnsureWorkspaceUseCase(input.harness, {
    setWorkspaceId: input.setWorkspaceId,
  }).execute({
    id: input.project.id,
    name: input.project.name,
    folderPath: input.project.folderPath,
    herdrWorkspaceId: input.project.herdrWorkspaceId ?? null,
  });

  const panes = await input.harness.listPanes(ensured.workspace.workspaceId);
  const placement = choosePlacement(panes, folder);
  const label = taskTabLabel(input.job.name);
  let paneId: string | null = null;
  try {
    if (placement.kind === "reuse") {
      paneId = placement.pane.paneId;
      const tabId = placement.pane.tabId;
      if (tabId && panes.filter((pane) => pane.tabId === tabId).length === 1) {
        await input.harness.renameTab(tabId, label);
      }
    } else {
      const created = await input.harness.createTab(ensured.workspace.workspaceId, label, folder);
      paneId = created.rootPane.paneId;
    }
    await input.harness.startAgent(
      agentNameForTask({ id: input.job.id, title: input.job.name }),
      agentKindForHarness(input.job.harness),
      paneId,
      { timeoutMs: input.timeoutMs },
    );
    return paneId;
  } catch (error) {
    throw new JobPaneError(errorMessage(error), paneId, isTimeoutError(error));
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return "The job dispatch failed.";
}
