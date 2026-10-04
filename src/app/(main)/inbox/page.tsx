import { projectRepo, taskRepo } from "@/infrastructure/container";
import { readLiveAgents } from "@/infrastructure/herdr/live-agents";
import { toProjectDto, toTaskDto } from "@/lib/dto";

import { InboxClient } from "./_components/inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const [tasks, projects, live] = await Promise.all([taskRepo.findAll(), projectRepo.findAll(), readLiveAgents()]);
  return <InboxClient initialTasks={tasks.map(toTaskDto)} projects={projects.map(toProjectDto)} initialLive={live} />;
}
