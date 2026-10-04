import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scanHostListeners } from "@/infrastructure/servers/host-listeners";

const TCP_HEADER = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";

function line(localAddress: string, state: string, uid: number, inode: number): string {
  return `   0: ${localAddress} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000     ${uid}        0 ${inode} 1 0000000000000000 100 0 0 10 0`;
}

/** Builds a fake procfs tree: net tables, uptime, and processes with socket fds. */
function makeProcFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "nexus-proc-"));
  const net = join(root, "1", "net");
  mkdirSync(net, { recursive: true });

  writeFileSync(
    join(net, "tcp"),
    [
      TCP_HEADER,
      line("00000000:0C8A", "0A", 0, 111), // 0.0.0.0:3210
      line("0100007F:2253", "0A", 1001, 222), // 127.0.0.1:8787
      line("0100007F:1F90", "01", 1001, 999), // established, not listening
      line("00000000:15B3", "0A", 1001, 555), // 0.0.0.0:5555, comm at the 15-char cap
    ].join("\n"),
  );
  writeFileSync(
    join(net, "tcp6"),
    [TCP_HEADER, line("00000000000000000000000001000000:0277", "0A", 0, 333)].join("\n"), // [::1]:631
  );
  writeFileSync(join(net, "udp"), [TCP_HEADER, line("00000000:115E", "07", 1001, 444)].join("\n")); // 0.0.0.0:4446
  writeFileSync(join(net, "udp6"), TCP_HEADER);
  writeFileSync(join(root, "uptime"), "5000.00 0.00\n");

  // Two processes: 4242 holds the 3210 and 8787 sockets, 4243 holds the UDP one.
  writeProcess(root, 4242, "docker-proxy", 100_000, [111, 222], undefined, {
    command:
      "/usr/bin/docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port 3210 -container-ip 172.19.0.2 -container-port 3100 -use-listen-fd",
  });
  writeProcess(root, 4243, "python3", 200_000, [444], undefined, {
    command: "python3 -m http.server 4446 --bind 0.0.0.0",
    cwd: "/home/sandbox/ws/biznagatec-ws/nagabot",
    home: "/home/sandbox",
  });
  writeProcess(root, 4244, "next-server (v1", 250_000, [555], "/usr/local/bin/node", {
    cgroup: "0::/../docker-6e778bb38b5e2c3767287b198fe170cde8109ba83584ddcd8fe835e898d8e059.scope",
  });
  return root;
}

interface ProcessExtra {
  command?: string;
  cwd?: string;
  home?: string;
  cgroup?: string;
}

function writeProcess(
  root: string,
  pid: number,
  comm: string,
  startTicks: number,
  inodes: number[],
  executable?: string,
  extra: ProcessExtra = {},
): void {
  const dir = join(root, String(pid));
  mkdirSync(join(dir, "fd"), { recursive: true });
  writeFileSync(join(dir, "comm"), `${comm}\n`);
  if (executable) symlinkSync(executable, join(dir, "exe"));
  if (extra.command) writeFileSync(join(dir, "cmdline"), `${extra.command.split(" ").join("\0")}\0`);
  if (extra.cwd) symlinkSync(extra.cwd, join(dir, "cwd"));
  if (extra.home) writeFileSync(join(dir, "environ"), `HOME=${extra.home}\0USER=test\0`);
  if (extra.cgroup) writeFileSync(join(dir, "cgroup"), `${extra.cgroup}\n`);
  // Fields 3..22 after the parenthesized comm; index 19 is starttime.
  const fields = Array.from({ length: 20 }, () => "0");
  fields[19] = String(startTicks);
  writeFileSync(join(dir, "stat"), `${pid} (${comm}) ${fields.join(" ")}\n`);
  inodes.forEach((inode, index) => {
    symlinkSync(`socket:[${inode}]`, join(dir, "fd", String(index + 3)));
  });
}
describe("scanHostListeners", () => {
  it("reads listening TCP and bound UDP sockets with scope, owner, pid, and uptime", () => {
    const snapshot = scanHostListeners({
      pidRoot: makeProcFixture(),
      now: () => new Date("2026-10-04T09:00:00.000Z"),
    });

    expect(snapshot.collectedAt).toBe("2026-10-04T09:00:00.000Z");
    expect(snapshot.listeners).toHaveLength(5);

    const board = snapshot.listeners.find((listener) => listener.port === 3210);
    expect(board).toMatchObject({
      protocol: "tcp",
      address: "0.0.0.0",
      scope: "public",
      process: "docker-proxy",
      pid: 4242,
      uid: 0,
      uptimeSeconds: 4000,
      container: { id: null, publish: { hostPort: 3210, containerIp: "172.19.0.2", containerPort: 3100 } },
    });

    const loopback = snapshot.listeners.find((listener) => listener.port === 8787);
    expect(loopback).toMatchObject({ address: "127.0.0.1", scope: "loopback", pid: 4242 });

    const udp = snapshot.listeners.find((listener) => listener.protocol === "udp");
    expect(udp).toMatchObject({
      port: 4446,
      address: "0.0.0.0",
      scope: "public",
      process: "python3",
      pid: 4243,
      cwd: "/home/sandbox/ws/biznagatec-ws/nagabot",
      home: "/home/sandbox",
      command: "python3 -m http.server 4446 --bind 0.0.0.0",
      container: null,
    });

    // tcp6 table decodes to ::1 and is loopback-scoped.
    const v6 = snapshot.listeners.find((listener) => listener.protocol === "tcp6");
    expect(v6).toMatchObject({ port: 631, address: "::1", scope: "loopback", process: null, pid: null });

    // A comm at the kernel's 15-character cap is truncated, so the exe basename wins.
    expect(snapshot.listeners.find((listener) => listener.port === 5555)).toMatchObject({
      process: "node",
      pid: 4244,
      // A cgroup naming a container is Docker evidence; a host process has none.
      container: { id: "6e778bb38b5e", publish: null },
    });
  });

  it("never attributes Docker to a plain host process", () => {
    const snapshot = scanHostListeners({ pidRoot: makeProcFixture() });
    const python = snapshot.listeners.find((listener) => listener.process === "python3");
    expect(python?.container).toBeNull();
  });

  it("sorts by port and skips sockets that are not listening", () => {
    const snapshot = scanHostListeners({ pidRoot: makeProcFixture() });
    expect(snapshot.listeners.map((listener) => listener.port)).toEqual([631, 3210, 4446, 5555, 8787]);
    expect(snapshot.listeners.some((listener) => listener.port === 8080)).toBe(false);
  });

  it("throws when the tcp table cannot be read, but tolerates a missing IPv6 table", () => {
    const root = mkdtempSync(join(tmpdir(), "nexus-proc-empty-"));
    mkdirSync(join(root, "1", "net"), { recursive: true });
    expect(() => scanHostListeners({ pidRoot: root })).toThrow(/Cannot read host sockets/);

    writeFileSync(join(root, "1", "net", "tcp"), TCP_HEADER);
    writeFileSync(join(root, "1", "net", "udp"), TCP_HEADER);
    const snapshot = scanHostListeners({ pidRoot: root });
    expect(snapshot.listeners).toEqual([]);
  });

  it("fails loudly when the container cannot see the host network namespace", () => {
    const root = mkdtempSync(join(tmpdir(), "nexus-proc-netns-"));
    const net = join(root, "1", "net");
    mkdirSync(net, { recursive: true });
    mkdirSync(join(root, "1", "ns"), { recursive: true });
    mkdirSync(join(root, "self", "ns"), { recursive: true });
    writeFileSync(join(net, "tcp"), TCP_HEADER);
    writeFileSync(join(net, "udp"), TCP_HEADER);
    // PID 1 shares our network namespace: `pid: host` is missing.
    symlinkSync("net:[4026532686]", join(root, "1", "ns", "net"));
    symlinkSync("net:[4026532686]", join(root, "self", "ns", "net"));

    expect(() => scanHostListeners({ pidRoot: root, containerized: true })).toThrow(/pid: host/);
    // On the host itself the same layout is legitimate.
    expect(scanHostListeners({ pidRoot: root, containerized: false }).listeners).toEqual([]);
  });
});
