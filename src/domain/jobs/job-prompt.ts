import type { Job } from "@/domain/jobs/job";

export type JobPromptProject = { name: string; folderPath: string | null };

/**
 * The instruction a due job pushes into an agent pane that already exists.
 * Mirrors `buildDispatchPrompt`: the same heading, project line, and brief, with
 * job wording in place of the task claim/complete commands. A scheduled run has
 * no task to claim, and it must not mark one reviewed.
 */
export function buildJobPrompt(job: Job, project: JobPromptProject | null): string {
  const projectLine = project
    ? `Project: ${project.name}${project.folderPath ? ` (${project.folderPath})` : ""}`
    : "Project: none";
  const brief = job.prompt.trim();

  return [
    `Nexus job #${job.id.slice(0, 8)} — ${job.name}`,
    projectLine,
    ...(brief ? ["", brief] : []),
    "",
    `Job id: ${job.id}`,
    "This is a scheduled job. Do the work above.",
    "Do not claim a Nexus task, and do not mark any task reviewed.",
  ].join("\n");
}
