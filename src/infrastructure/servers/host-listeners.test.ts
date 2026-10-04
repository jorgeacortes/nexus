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
  writeProcess(root, 4242, "docker-proxy", 100_000, [111, 222]);
  writeProcess(root, 4243, "python3", 200_000, [444]);
  writeProcess(root, 4244, "next-server (v1", 250_000, [555], "/usr/local/bin/node");
  return root;
}

function writeProcess(
  root: string,
  pid: number,
  comm: string,
  startTicks: number,
  inodes: number[],
  executable?: string,
): void {
  const dir = join(root, String(pid));
  mkdirSync(join(dir, "fd"), { recursive: true });
  writeFileSync(join(dir, "comm"), `${comm}\n`);
  if (executable) symlinkSync(executable, join(dir, "exe"));
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
    });

    const loopback = snapshot.listeners.find((listener) => listener.port === 8787);
    expect(loopback).toMatchObject({ address: "127.0.0.1", scope: "loopback", pid: 4242 });

    const udp = snapshot.listeners.find((listener) => listener.protocol === "udp");
    expect(udp).toMatchObject({ port: 4446, address: "0.0.0.0", scope: "public", process: "python3", pid: 4243 });

    // tcp6 table decodes to ::1 and is loopback-scoped.
    const v6 = snapshot.listeners.find((listener) => listener.protocol === "tcp6");
    expect(v6).toMatchObject({ port: 631, address: "::1", scope: "loopback", process: null, pid: null });

    // A comm at the kernel's 15-character cap is truncated, so the exe basename wins.
    expect(snapshot.listeners.find((listener) => listener.port === 5555)).toMatchObject({
      process: "node",
      pid: 4244,
    });
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
