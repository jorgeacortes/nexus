import { taskRepo } from "@/infrastructure/container";
import { readLiveAgents } from "@/infrastructure/herdr/live-agents";
import { toTaskDto } from "@/lib/dto";

import { AgentsClient } from "./_components/agents-client";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const [live, tasks] = await Promise.all([readLiveAgents(), taskRepo.findAll()]);
  return <AgentsClient initialLive={live} tasks={tasks.map(toTaskDto)} />;
}
