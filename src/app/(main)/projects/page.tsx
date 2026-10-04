import { projectRepo, taskRepo } from "@/infrastructure/container";
import { toProjectDto } from "@/lib/dto";

import { type ProjectStats, ProjectsClient } from "./_components/projects-client";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const [projects, tasks] = await Promise.all([projectRepo.findAll(), taskRepo.findAll()]);

  const stats: Record<string, ProjectStats> = {};
  for (const task of tasks) {
    if (!task.projectId) continue;
    const entry = stats[task.projectId] ?? { open: 0, total: 0, needsHuman: 0 };
    entry.total += 1;
    if (task.status !== "done") entry.open += 1;
    if (task.needsHuman) entry.needsHuman += 1;
    stats[task.projectId] = entry;
  }

  return <ProjectsClient initialProjects={projects.map(toProjectDto)} stats={stats} />;
}
