import { herdrClient } from "@/infrastructure/container";
import { EMPTY_LIVE_AGENTS, type LiveAgentsPayload, toLiveAgents } from "@/lib/herdr";

/**
 * Reads the live Herdr session for server rendering. Herdr is best-effort: when
 * the socket is down the payload reports `available: false` instead of failing
 * the screen, and SQLite-owned task state still renders.
 */
export async function readLiveAgents(): Promise<LiveAgentsPayload> {
  try {
    return toLiveAgents(await herdrClient.snapshot());
  } catch (error) {
    return { ...EMPTY_LIVE_AGENTS, error: error instanceof Error ? error.message : "Herdr unavailable" };
  }
}
