import type { HostListener, NexusPorts, ServerCollectorPort } from "@/infrastructure/servers/server-collector";

/** Which Nexus port a listener is, when it is one of ours. */
export type NexusRole = "board" | "dev";

/** A host listener enriched with Nexus knowledge (JSON-safe for the UI). */
export type ServerListener = HostListener & { nexusRole: NexusRole | null };

export interface ServersPayload {
  /** False when the host could not be read at all — never confused with an empty list. */
  available: boolean;
  error: string | null;
  collectedAt: string | null;
  listeners: ServerListener[];
}

export const EMPTY_SERVERS: ServersPayload = { available: false, error: null, collectedAt: null, listeners: [] };

/**
 * Read-only view of what is listening on the host. The collector is best-effort
 * in the same way Herdr is: a failure reports `available: false` with the reason
 * instead of throwing, so a dead collector can never render as "nothing is
 * listening". Listener rows are marked when their port is one of Nexus' own.
 */
export class ReadServersUseCase {
  constructor(
    private readonly collector: ServerCollectorPort,
    private readonly nexusPorts: NexusPorts,
  ) {}

  async execute(): Promise<ServersPayload> {
    try {
      const snapshot = await this.collector.collect();
      return {
        available: true,
        error: null,
        collectedAt: snapshot.collectedAt,
        listeners: snapshot.listeners.map((listener) => ({ ...listener, nexusRole: this.roleOf(listener) })),
      };
    } catch (error) {
      return {
        ...EMPTY_SERVERS,
        error: error instanceof Error ? error.message : "Host listeners unavailable",
      };
    }
  }

  private roleOf(listener: HostListener): NexusRole | null {
    if (listener.port === this.nexusPorts.board) return "board";
    if (listener.port === this.nexusPorts.dev) return "dev";
    return null;
  }
}
