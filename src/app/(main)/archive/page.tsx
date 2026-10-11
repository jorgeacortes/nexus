import { listTasks, projectRepo } from "@/infrastructure/container";
import { toProjectDto, toTaskDto } from "@/lib/dto";

import { ArchiveTable } from "./_components/archive-table";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const [tasks, projects] = await Promise.all([listTasks.execute({ archived: "only" }), projectRepo.findAll()]);
  return <ArchiveTable tasks={tasks.map(toTaskDto)} projects={projects.map(toProjectDto)} />;
}
