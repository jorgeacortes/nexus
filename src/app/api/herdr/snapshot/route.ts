import { NextResponse } from "next/server";

import { readLiveAgents } from "@/infrastructure/herdr/live-agents";

export const dynamic = "force-dynamic";

/**
 * Normalized live agent state. Returns 200 even when Herdr is unreachable —
 * `available: false` lets the UI degrade without treating it as a request error.
 */
export async function GET() {
  const payload = await readLiveAgents();
  return NextResponse.json({ data: payload, error: null });
}
