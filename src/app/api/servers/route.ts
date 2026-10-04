import { NextResponse } from "next/server";

import { ReadServersUseCase } from "@/application/servers/read-servers";
import { containerInventory, nexusPorts, serverCollector } from "@/infrastructure/container";

export const dynamic = "force-dynamic";

/**
 * What is listening on the host, read from procfs and enriched with Docker
 * container names. Returns 200 even when the host is unreadable —
 * `available: false` plus the reason lets the UI say the collector is
 * unreachable rather than showing an empty list.
 */
export async function GET() {
  const payload = await new ReadServersUseCase(serverCollector, nexusPorts, containerInventory).execute();
  return NextResponse.json({ data: payload, error: null });
}
