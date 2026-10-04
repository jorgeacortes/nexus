import type { NexusRole, ServerListener, ServersPayload } from "@/application/servers/read-servers";
import type { ListenerProtocol, ListenerScope } from "@/infrastructure/servers/server-collector";

export type { NexusRole, ServerListener, ServersPayload };

/** How a Nexus-owned listener is labelled in the list. */
export const NEXUS_ROLE_LABELS: Record<NexusRole, string> = {
  board: "Nexus board · nexus-nexus-1",
  dev: "Nexus dev",
};

export const PROTOCOL_LABELS: Record<ListenerProtocol, string> = {
  tcp: "TCP",
  tcp6: "TCP6",
  udp: "UDP",
  udp6: "UDP6",
};

export const SCOPE_LABELS: Record<ListenerScope, string> = {
  loopback: "loopback",
  public: "all interfaces",
  interface: "interface",
};

/** Polling cadence of the Servers screen; also stated in the UI. */
export const SERVERS_POLL_INTERVAL_MS = 5000;

/** The process behind a listener, falling back to the socket's owner uid. */
export function serviceName(listener: ServerListener): string {
  if (listener.process) return listener.process;
  return listener.uid === null ? "unknown" : `uid ${listener.uid}`;
}

/** "45s" / "12m" / "3h 20m" / "4d 6h"; em dash when the pid is unknown. */
export function formatUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Free-text match over port, protocol, bind address, process, pid, and Nexus role. */
export function matchesServerFilter(listener: ServerListener, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = [
    String(listener.port),
    listener.protocol,
    listener.address,
    listener.process ?? "",
    listener.pid === null ? "" : String(listener.pid),
    listener.nexusRole === null ? "" : NEXUS_ROLE_LABELS[listener.nexusRole],
  ];
  return haystack.some((value) => value.toLowerCase().includes(needle));
}
