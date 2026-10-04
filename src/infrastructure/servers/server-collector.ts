import { type HostListenersSnapshot, scanHostListeners } from "@/infrastructure/servers/host-listeners";

export type {
  HostListener,
  HostListenersSnapshot,
  ListenerProtocol,
  ListenerScope,
  ScanHostListenersOptions,
} from "@/infrastructure/servers/host-listeners";

/**
 * Port: how Nexus reads what is listening on the host. Mirrors `HerdrPort` in
 * `src/infrastructure/herdr/`: the adapter lives here, the use case in
 * `src/application/servers/`, and nothing else touches `/proc`.
 */
export interface ServerCollectorPort {
  collect(): Promise<HostListenersSnapshot>;
}

/**
 * Adapter: the host's procfs, reachable because the Compose service runs with
 * `pid: host` (see `AGENTS.md` → "Host listeners" for the decision and why the
 * alternative — a sidecar writing a snapshot file — was not needed).
 */
export class ProcfsServerCollector implements ServerCollectorPort {
  async collect(): Promise<HostListenersSnapshot> {
    return scanHostListeners();
  }
}

/** The ports Nexus itself is reachable on: the published board port and dev. */
export interface NexusPorts {
  /** `HOST_PORT` — the published port of the deployed container (default 3210). */
  board: number;
  /** `PORT` — the dev server (default 3100). */
  dev: number;
}

export function resolveNexusPorts(env: NodeJS.Dict<string> = process.env): NexusPorts {
  return { board: portOr(env.HOST_PORT, 3210), dev: portOr(env.PORT, 3100) };
}

function portOr(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : fallback;
}
