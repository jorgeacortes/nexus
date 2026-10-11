import { listTasks, projectRepo } from "@/infrastructure/container";
import { readLiveAgents } from "@/infrastructure/herdr/live-agents";
import { toProjectDto, toTaskDto } from "@/lib/dto";

import { BoardClient } from "./_components/board-client";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const [tasks, projects, live] = await Promise.all([listTasks.execute(), projectRepo.findAll(), readLiveAgents()]);
  return (
    <BoardClient initialTasks={tasks.map(toTaskDto)} initialProjects={projects.map(toProjectDto)} initialLive={live} />
  );
}
