import { MissingProjectFolderError } from "@/application/dispatch/errors";
import type { HarnessPort, HarnessWorkspace } from "@/domain/dispatch/harness";
import type { DispatchProject, ProjectWorkspacePort } from "@/domain/dispatch/project-workspace";

/** How the project's live workspace was found. */
export type EnsureWorkspaceOutcome = "stored" | "matched" | "created";

/** What a `matched` resolution keyed on. */
export type EnsureWorkspaceMatch = "label" | "folder";

export interface EnsureWorkspaceResult {
  workspace: HarnessWorkspace;
  outcome: EnsureWorkspaceOutcome;
  /** Null for a stored id and for a fresh workspace; set only for a match. */
  matchedBy: EnsureWorkspaceMatch | null;
}

function expandHome(folder: string): string {
  const home = process.env.HOME ?? "";
  const expanded = folder.startsWith("~/") && home ? `${home}/${folder.slice(2)}` : folder;
  return expanded.replace(/\/+$/, "");
}

function sameLabel(label: string, projectName: string): boolean {
  return label.trim().toLowerCase() === projectName.trim().toLowerCase();
}

/**
 * Resolves the Herdr workspace a project runs in, in the order the design fixes:
 *
 * 1. `project.herdrWorkspaceId` **iff** the live snapshot still has it.
 * 2. otherwise a live workspace whose label matches the project name, or whose
 *    panes run in `project.folderPath`.
 * 3. otherwise create one (`label = project name`, `cwd = folderPath`) and
 *    persist its id back onto the project.
 *
 * The writeback happens for 2 and 3 as well, so a **dead** stored id is always
 * repaired rather than left dangling — it is never silently used, and a match or
 * creation is never left unrecorded. Refuses, rather than creating a workspace in
 * a guessed cwd, when the project has no folder.
 */
export class EnsureWorkspaceUseCase {
  constructor(
    private readonly harness: HarnessPort,
    private readonly projects: ProjectWorkspacePort,
  ) {}

  async execute(project: DispatchProject): Promise<EnsureWorkspaceResult> {
    const workspaces = await this.harness.listWorkspaces();

    // 1. The stored pointer wins only while Herdr still reports that workspace.
    if (project.herdrWorkspaceId) {
      const stored = workspaces.find((workspace) => workspace.workspaceId === project.herdrWorkspaceId);
      if (stored) {
        return { workspace: stored, outcome: "stored", matchedBy: null };
      }
    }

    // 2. Adopt a live workspace that is already this project's — and record it, so
    // a dangling stored id (or a null one) ends up pointing at the live workspace.
    const matched = await this.findMatch(project, workspaces);
    if (matched) {
      await this.projects.setWorkspaceId(project.id, matched.workspace.workspaceId);
      return { workspace: matched.workspace, outcome: "matched", matchedBy: matched.matchedBy };
    }

    // 3. Nothing live matches: create one, which needs a folder to create in.
    const folder = project.folderPath?.trim() || null;
    if (!folder) {
      throw new MissingProjectFolderError(project.name);
    }
    const created = await this.harness.createWorkspace(project.name, folder);
    await this.projects.setWorkspaceId(project.id, created.workspaceId);
    return { workspace: created, outcome: "created", matchedBy: null };
  }

  /** Label first (preferring a label match that also owns the folder), then cwd. */
  private async findMatch(
    project: DispatchProject,
    workspaces: HarnessWorkspace[],
  ): Promise<{ workspace: HarnessWorkspace; matchedBy: EnsureWorkspaceMatch } | null> {
    const byLabel = workspaces.filter((workspace) => sameLabel(workspace.label, project.name));
    if (byLabel.length > 0) {
      const withFolder = await this.firstRunningIn(byLabel, project.folderPath);
      return { workspace: withFolder ?? byLabel[0], matchedBy: "label" };
    }
    const byFolder = await this.firstRunningIn(workspaces, project.folderPath);
    if (byFolder) {
      return { workspace: byFolder, matchedBy: "folder" };
    }
    return null;
  }

  private async firstRunningIn(
    workspaces: HarnessWorkspace[],
    folderPath: string | null,
  ): Promise<HarnessWorkspace | null> {
    if (!folderPath) return null;
    const folder = expandHome(folderPath.trim());
    if (folder === "") return null;
    for (const workspace of workspaces) {
      const panes = await this.harness.listPanes(workspace.workspaceId);
      if (panes.some((pane) => pane.cwd !== null && expandHome(pane.cwd) === folder)) {
        return workspace;
      }
    }
    return null;
  }
}
