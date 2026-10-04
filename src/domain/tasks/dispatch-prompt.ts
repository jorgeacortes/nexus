import { shortTaskId, type Task } from "./task";

export type DispatchProject = { name: string; folderPath: string | null };

/**
 * The instruction Nexus pushes into an agent pane. Kept in the tasks domain so
 * the CLI and the web UI dispatch the same wording; it mirrors `skills/nx-tasks`.
 */
export function buildDispatchPrompt(task: Task, project: DispatchProject | null): string {
  const projectLine = project
    ? `Project: ${project.name}${project.folderPath ? ` (${project.folderPath})` : ""}`
    : "Project: none";
  const description = task.description?.trim();

  return [
    `Nexus task #${shortTaskId(task.id)} — ${task.title}`,
    projectLine,
    ...(description ? ["", description] : []),
    "",
    `Claim it first:       nx claim ${task.id}`,
    `Work it, then finish: nx done ${task.id} --notes "<commit or artifact>"`,
    `Need the operator?    nx need ${task.id} --reason "<what you are waiting on>"`,
    "",
    "Always claim before starting and complete when finished; never edit task rows directly.",
  ].join("\n");
}
