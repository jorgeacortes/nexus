import { ReadServersUseCase } from "@/application/servers/read-servers";
import { nexusPorts, serverCollector } from "@/infrastructure/container";

import { ServersClient } from "./_components/servers-client";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
  const servers = await new ReadServersUseCase(serverCollector, nexusPorts).execute();
  return <ServersClient initialServers={servers} />;
}
