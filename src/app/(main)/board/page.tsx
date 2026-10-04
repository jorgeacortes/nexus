import { projectRepo, taskRepo } from "@/infrastructure/container";
import { toProjectDto, toTaskDto } from "@/lib/dto";

import { BoardClient } from "./_components/board-client";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const [tasks, projects] = await Promise.all([taskRepo.findAll(), projectRepo.findAll()]);
  return <BoardClient initialTasks={tasks.map(toTaskDto)} initialProjects={projects.map(toProjectDto)} />;
}
