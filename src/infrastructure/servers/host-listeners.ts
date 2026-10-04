import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";

export type ListenerProtocol = "tcp" | "tcp6" | "udp" | "udp6";

/** Where a socket is reachable from: loopback only, every interface, or one address. */
export type ListenerScope = "loopback" | "public" | "interface";

/** One listening (or bound) host socket, as read from the host's procfs. */
export interface HostListener {
  protocol: ListenerProtocol;
  /** Decoded bind address: `0.0.0.0`, `127.0.0.1`, `::`, `::1`, or a specific address. */
  address: string;
  port: number;
  scope: ListenerScope;
  /** Owning process name, or null when the process is not inspectable. */
  process: string | null;
  pid: number | null;
  /** Socket owner uid from the procfs table; always present. */
  uid: number | null;
  /** Process uptime in seconds, or null when the pid is unknown. */
  uptimeSeconds: number | null;
}

export interface HostListenersSnapshot {
  /** When the snapshot was read, ISO-8601. */
  collectedAt: string;
  listeners: HostListener[];
}

export interface ScanHostListenersOptions {
  /** procfs root — `/proc` in production, a fixture directory in tests. */
  pidRoot?: string;
  /** The pid whose network namespace holds the host sockets (host PID 1). */
  netPid?: string | number;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Override container detection (tests). */
  containerized?: boolean;
}

/** `USER_HZ`: the clock tick rate `/proc/<pid>/stat` starttime is expressed in. */
const CLOCK_TICKS_PER_SECOND = 100;

interface NetSocket {
  protocol: ListenerProtocol;
  address: string;
  port: number;
  uid: number;
  inode: number;
}

/**
 * Reads what is listening on the host from procfs.
 *
 * The container runs with `pid: host`, so `${pidRoot}` is the host's procfs and
 * `${pidRoot}/1/net` is the host's network namespace (the container's own
 * `/proc/net` would only show the container). Socket inodes are then matched
 * against every visible process's open file descriptors to name the owner; that
 * needs `CAP_SYS_PTRACE` and `CAP_DAC_OVERRIDE` on the app user (the entrypoint
 * grants them as ambient capabilities), and degrades to `process: null` when they
 * are missing. Nothing here is fatal to the screen — the use case turns a throw
 * into "collector unreachable".
 */
export function scanHostListeners(options: ScanHostListenersOptions = {}): HostListenersSnapshot {
  const pidRoot = options.pidRoot ?? "/proc";
  const netPid = String(options.netPid ?? 1);
  const netDir = join(pidRoot, netPid, "net");
  const now = options.now ?? (() => new Date());

  assertHostNamespaceVisible(pidRoot, netPid, options.containerized ?? isContainerized());

  const sockets: NetSocket[] = [
    ...readNetTable(join(netDir, "tcp"), "tcp", { optional: false }),
    ...readNetTable(join(netDir, "tcp6"), "tcp6", { optional: true }),
    ...readNetTable(join(netDir, "udp"), "udp", { optional: false }),
    ...readNetTable(join(netDir, "udp6"), "udp6", { optional: true }),
  ];

  const ownerByInode = mapInodesToPids(pidRoot, new Set(sockets.map((socket) => socket.inode)));
  const bootSeconds = readBootSeconds(pidRoot);

  const listeners = sockets
    .map((socket) => {
      const pid = ownerByInode.get(socket.inode) ?? null;
      return {
        protocol: socket.protocol,
        address: socket.address,
        port: socket.port,
        scope: scopeOf(socket.address),
        pid,
        process: pid === null ? null : readProcessName(pidRoot, pid),
        uid: socket.uid,
        uptimeSeconds: pid === null ? null : readProcessUptime(pidRoot, pid, bootSeconds),
      } satisfies HostListener;
    })
    .sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol) || a.address.localeCompare(b.address));

  return { collectedAt: now().toISOString(), listeners };
}

function isContainerized(): boolean {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv") || Boolean(process.env.container);
}

/**
 * Inside a container without `pid: host`, PID 1 *is* the container and its
 * network namespace is ours: the tables would be empty and the screen would
 * claim nothing is listening on a host it never saw. Fail with the fix instead.
 */
function assertHostNamespaceVisible(pidRoot: string, netPid: string, containerized: boolean): void {
  if (!containerized) return;
  const own = readNamespace(join(pidRoot, "self", "ns", "net"));
  const host = readNamespace(join(pidRoot, netPid, "ns", "net"));
  if (own !== null && own === host) {
    throw new Error(
      "Host procfs is not visible from this container: start it with `pid: host` (see docker-compose.yml).",
    );
  }
}

function readNamespace(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

function readNetTable(file: string, protocol: ListenerProtocol, { optional }: { optional: boolean }): NetSocket[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    // An absent IPv6 table is a legitimate host state; an unreadable tcp/udp
    // table means we cannot see the host at all and must say so.
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Cannot read host sockets at ${file}: ${error instanceof Error ? error.message : "unknown"}`);
  }
  return parseNetTable(text, protocol);
}

function parseNetTable(text: string, protocol: ListenerProtocol): NetSocket[] {
  const sockets: NetSocket[] = [];
  const lines = text.split("\n");
  for (const line of lines.slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) continue;
    // TCP bound sockets are 0A (LISTEN); UDP has no listen state, so an
    // unconnected bound socket shows 07 (CLOSE).
    const state = fields[3];
    if (protocol.startsWith("tcp") ? state !== "0A" : state !== "07") continue;
    const [addressHex, portHex] = fields[1].split(":");
    const inode = Number(fields[9]);
    if (!addressHex || !portHex || !Number.isFinite(inode) || inode === 0) continue;
    sockets.push({
      protocol,
      address: decodeAddress(addressHex, protocol),
      port: Number.parseInt(portHex, 16),
      uid: Number(fields[7]),
      inode,
    });
  }
  return sockets;
}

/** Walks `/proc/<pid>/fd` and returns the first pid holding each wanted socket inode. */
function mapInodesToPids(pidRoot: string, wanted: Set<number>): Map<number, number> {
  const owners = new Map<number, number>();
  if (wanted.size === 0) return owners;

  let entries: string[];
  try {
    entries = readdirSync(pidRoot);
  } catch {
    return owners;
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let fds: string[];
    try {
      fds = readdirSync(join(pidRoot, entry, "fd"));
    } catch {
      continue; // Not ours to inspect (no CAP_SYS_PTRACE, another user, gone).
    }
    for (const fd of fds) {
      let link: string;
      try {
        link = readlinkSync(join(pidRoot, entry, "fd", fd));
      } catch {
        continue;
      }
      if (!link.startsWith("socket:[")) continue;
      const inode = Number(link.slice("socket:[".length, -1));
      if (!wanted.has(inode) || owners.has(inode)) continue;
      owners.set(inode, Number(entry));
    }
  }
  return owners;
}

function readProcessName(pidRoot: string, pid: number): string | null {
  const name = readComm(pidRoot, pid);
  // The kernel caps comm at 15 characters, so a name at the cap may be cut off
  // ("next-server (v1"); the executable's basename is the honest fallback.
  if (name !== null && name.length >= 15) {
    const executable = readExecutable(pidRoot, pid);
    if (executable !== null) return executable;
  }
  return name;
}

function readComm(pidRoot: string, pid: number): string | null {
  try {
    const name = readFileSync(join(pidRoot, String(pid), "comm"), "utf8").trim();
    return name === "" ? null : name;
  } catch {
    return null;
  }
}

function readExecutable(pidRoot: string, pid: number): string | null {
  try {
    const target = readlinkSync(join(pidRoot, String(pid), "exe"));
    return basename(target) || null;
  } catch {
    return null;
  }
}

function readBootSeconds(pidRoot: string): number | null {
  try {
    const uptime = Number(readFileSync(join(pidRoot, "uptime"), "utf8").split(/\s+/)[0]);
    return Number.isFinite(uptime) ? uptime : null;
  } catch {
    return null;
  }
}

function readProcessUptime(pidRoot: string, pid: number, bootSeconds: number | null): number | null {
  if (bootSeconds === null) return null;
  let stat: string;
  try {
    stat = readFileSync(join(pidRoot, String(pid), "stat"), "utf8");
  } catch {
    return null;
  }
  const ticks = parseStartTimeTicks(stat);
  if (ticks === null) return null;
  return Math.max(0, Math.round(bootSeconds - ticks / CLOCK_TICKS_PER_SECOND));
}

/**
 * Field 22 of `/proc/<pid>/stat` (starttime, in clock ticks since boot). The
 * comm field is parenthesized and may itself contain spaces or parens, so the
 * fields after the last `)` are what we split.
 */
function parseStartTimeTicks(stat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const ticks = Number(fields[19]); // field 3 is index 0
  return Number.isFinite(ticks) ? ticks : null;
}

function decodeAddress(hex: string, protocol: ListenerProtocol): string {
  if (protocol === "tcp6" || protocol === "udp6") return decodeIpv6(hex);
  return decodeIpv4(hex);
}

/** `/proc/net/tcp` stores each of the four address bytes little-endian. */
function decodeIpv4(hex: string): string {
  return [6, 4, 2, 0].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(".");
}

/** `/proc/net/tcp6` stores eight bytes per 32-bit word, each word little-endian. */
function decodeIpv6(hex: string): string {
  const bytes: number[] = [];
  for (let word = 0; word < 4; word++) {
    const chunk = hex.slice(word * 8, word * 8 + 8);
    for (const offset of [6, 4, 2, 0]) bytes.push(Number.parseInt(chunk.slice(offset, offset + 2), 16));
  }
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return `::ffff:${bytes.slice(12).join(".")}`;
  }
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);

  // Compress the longest run of zero groups (RFC 5952), keeping it printable.
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] !== 0) continue;
    let end = i;
    while (end < groups.length && groups[end] === 0) end++;
    if (end - i > bestLength) {
      bestStart = i;
      bestLength = end - i;
    }
    i = end;
  }
  if (bestLength < 2) return groups.map((group) => group.toString(16)).join(":");
  const head = groups
    .slice(0, bestStart)
    .map((group) => group.toString(16))
    .join(":");
  const tail = groups
    .slice(bestStart + bestLength)
    .map((group) => group.toString(16))
    .join(":");
  return `${head}::${tail}`;
}

function scopeOf(address: string): ListenerScope {
  const v4 = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  if (v4 === "0.0.0.0" || v4 === "::") return "public";
  if (v4 === "::1" || v4.startsWith("127.")) return "loopback";
  return "interface";
}
