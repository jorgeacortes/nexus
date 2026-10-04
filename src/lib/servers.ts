import type { NexusRole, ServerListener, ServersPayload } from "@/application/servers/read-servers";
import type { ContainerAttribution, ListenerProtocol, ListenerScope } from "@/infrastructure/servers/server-collector";

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

/**
 * The web-app rule, stated so it can be read off the screen: a listener is one
 * of the operator's apps when it is a published Docker port (container sockets
 * are the operator's by construction), or when a non-root process from this
 * runtime allowlist owns it. Everything else — cupsd, systemd-resolved,
 * systemd-networkd, a root daemon — is a host service. There is no HTTP probe:
 * the screen polls every 5s and must not become a request generator.
 */
export const WEB_APP_RUNTIMES: ReadonlySet<string> = new Set([
  "bun",
  "deno",
  "gunicorn",
  "node",
  "next-server",
  "npm",
  "php",
  "php-fpm",
  "pnpm",
  "puma",
  "python",
  "python3",
  "ruby",
  "tsx",
  "uvicorn",
  "vite",
  "yarn",
]);

/** Which group a listener belongs in on the screen. */
export type ListenerKind = "app" | "service";

export const KIND_LABELS: Record<ListenerKind, string> = { app: "Web apps", service: "Host services" };

/** Polling cadence of the Servers screen; also stated in the UI. */
export const SERVERS_POLL_INTERVAL_MS = 5000;

export function listenerKind(listener: ServerListener): ListenerKind {
  if (listener.container) return "app";
  if (listener.uid === 0) return "service";
  if (listener.process && WEB_APP_RUNTIMES.has(listener.process)) return "app";
  return "service";
}

/** What a row is: the app name, not the socket. */
export function listenerName(listener: ServerListener): string {
  if (listener.container) return containerName(listener.container);
  // A host daemon is known by its process; a folder is the identity of an app,
  // and cupsd's `/var/snap/cups/1262` is not a name anyone would recognise.
  if (listenerKind(listener) === "app" && listener.cwd) return folderBasename(listener.cwd);
  if (listener.process) return listener.process;
  if (listener.cwd) return folderBasename(listener.cwd);
  return listener.uid === null ? "unknown" : `uid ${listener.uid}`;
}

function containerName(container: ContainerAttribution): string {
  return container.id === null ? "Docker container" : `Docker container ${container.id}`;
}

/** The last path segment of a working directory; `/` keeps its own name. */
function folderBasename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  const base = index < 0 ? trimmed : trimmed.slice(index + 1);
  return base === "" ? trimmed || path : base;
}

/** `~/ws/biznagatec-ws/nagabot`; falls back to the raw path when `$HOME` is unknown. */
export function formatFolder(cwd: string | null, home: string | null): string | null {
  if (cwd === null) return null;
  if (home !== null && home !== "/" && (cwd === home || cwd.startsWith(`${home}/`))) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

/**
 * The honest value for the folder/container column: a real path, a published
 * mapping, or an explicit statement that it could not be read. Never a bare
 * dash, because "unreadable" and "this app has no folder" are different facts.
 */
export function folderDetail(listener: ServerListener): string {
  if (listener.container) {
    const publish = listener.container.publish;
    if (publish) {
      return `Docker · published ${publish.hostPort} → container ${publish.containerIp}:${publish.containerPort}`;
    }
    return `Docker · container ${listener.container.id ?? "id unreadable"}`;
  }
  const folder = formatFolder(listener.cwd, listener.home);
  if (folder) return folder;
  if (listener.pid !== null) return "folder not readable for this process";
  return "owner not identified";
}

/** `python3 · http.server` from argv, so two python servers are told apart. */
export function runtimeDetail(listener: ServerListener): string | null {
  if (listener.container) return null;
  const argv = listener.command?.split(" ").filter(Boolean) ?? [];
  const executable = argv[0]?.split("/").pop();
  if (listener.process && executable && executable !== listener.process) return listener.process;
  const subcommand = argv.slice(1).find((arg) => !arg.startsWith("-"));
  if (listener.process && subcommand) return `${listener.process} · ${subcommand}`;
  return listener.process ?? null;
}

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
    listener.cwd ?? "",
    listener.command ?? "",
    listener.container?.id ?? "",
    listener.container?.publish?.containerIp ?? "",
    listener.container?.publish?.containerPort === undefined ? "" : String(listener.container.publish.containerPort),
    listener.nexusRole === null ? "" : NEXUS_ROLE_LABELS[listener.nexusRole],
  ];
  return haystack.some((value) => value.toLowerCase().includes(needle));
}

/**
 * One row per app, not per socket: a service's TCP/UDP and per-address variants
 * (docker-proxy publishing two host IPs, systemd-resolved on two loopback
 * addresses) collapse into a single row that lists its ports and binds.
 */
export interface ListenerGroup {
  key: string;
  kind: ListenerKind;
  name: string;
  /** Home-shortened working directory, when the owner is a host process. */
  folder: string | null;
  /** The honest folder/container text for the row. */
  detail: string;
  /** `python3 · http.server`, when it can be derived. */
  runtime: string | null;
  container: ContainerAttribution | null;
  ports: number[];
  addresses: string[];
  protocols: ListenerProtocol[];
  /** How many sockets collapsed into this row; 1 means a single socket. */
  sockets: number;
  /** The widest exposure across the group's sockets. */
  scope: ListenerScope;
  uid: number | null;
  pids: number[];
  /** Uptime of the oldest socket in the group. */
  uptimeSeconds: number | null;
  nexusRole: NexusRole | null;
  listeners: ServerListener[];
}

/**
 * Groups a service's sockets into one row. Docker rows collapse by container
 * mapping (docker-proxy runs one process per host IP); host rows collapse by
 * pid, and a listener whose owner we could not name stays its own row.
 */
export function groupKey(listener: ServerListener): string {
  if (listener.container) {
    const published = listener.container.publish;
    const identity = published ? `${published.containerIp}:${published.containerPort}` : (listener.container.id ?? "");
    if (identity !== "") return `container:${identity}`;
  }
  if (listener.pid !== null) return `pid:${listener.pid}`;
  return `socket:${listener.protocol}:${listener.address}:${listener.port}`;
}

const SCOPE_RANK: Record<ListenerScope, number> = { loopback: 0, interface: 1, public: 2 };

export function groupListeners(listeners: ServerListener[]): ListenerGroup[] {
  const groups = new Map<string, ServerListener[]>();
  for (const listener of listeners) {
    const key = groupKey(listener);
    const bucket = groups.get(key);
    if (bucket) bucket.push(listener);
    else groups.set(key, [listener]);
  }

  return [...groups.entries()]
    .map(([key, members]) => {
      const first = members[0];
      const scope = members.reduce<ListenerScope>(
        (widest, listener) => (SCOPE_RANK[listener.scope] > SCOPE_RANK[widest] ? listener.scope : widest),
        "loopback",
      );
      const uptimes = members.map((listener) => listener.uptimeSeconds).filter((value) => value !== null);
      const name = listenerName(first);
      const runtime = runtimeDetail(first);
      return {
        key,
        kind: listenerKind(first),
        name,
        folder: formatFolder(first.cwd, first.home),
        detail: folderDetail(first),
        // A runtime that only repeats the name (cupsd, systemd-resolved) is noise.
        runtime: runtime === name ? null : runtime,
        container: first.container,
        ports: unique(members.map((listener) => listener.port)).sort((a, b) => a - b),
        addresses: unique(members.map((listener) => listener.address)),
        protocols: unique(members.map((listener) => listener.protocol)),
        sockets: members.length,
        scope,
        uid: first.uid,
        pids: unique(members.flatMap((listener) => (listener.pid === null ? [] : [listener.pid]))),
        uptimeSeconds: uptimes.length === 0 ? null : Math.min(...uptimes),
        nexusRole: members.find((listener) => listener.nexusRole !== null)?.nexusRole ?? null,
        listeners: members,
      } satisfies ListenerGroup;
    })
    .sort((a, b) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Free-text match over everything a group's row shows, including folder and container. */
export function matchesGroupFilter(group: ListenerGroup, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = [
    group.name,
    group.folder ?? "",
    group.detail,
    group.runtime ?? "",
    group.container?.id ?? "",
    group.nexusRole === null ? "" : NEXUS_ROLE_LABELS[group.nexusRole],
    ...group.ports.map(String),
    ...group.addresses,
    ...group.protocols,
    ...group.pids.map(String),
  ];
  return haystack.some((value) => value.toLowerCase().includes(needle));
}

/** The top-line answer: how many apps, how many sockets, and how much is exposed. */
export interface ServersSummary {
  apps: number;
  services: number;
  listeners: number;
  publicListeners: number;
  dockerListeners: number;
}

export function summarizeServers(listeners: ServerListener[]): ServersSummary {
  const groups = groupListeners(listeners);
  return {
    apps: groups.filter((group) => group.kind === "app").length,
    services: groups.filter((group) => group.kind === "service").length,
    listeners: listeners.length,
    publicListeners: listeners.filter((listener) => listener.scope === "public").length,
    dockerListeners: listeners.filter((listener) => listener.container !== null).length,
  };
}
