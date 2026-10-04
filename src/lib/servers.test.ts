import { describe, expect, it } from "vitest";

import type { ServerListener } from "@/lib/servers";
import {
  folderDetail,
  formatFolder,
  groupListeners,
  listenerKind,
  listenerName,
  matchesGroupFilter,
  summarizeServers,
} from "@/lib/servers";

function listener(overrides: Partial<ServerListener> = {}): ServerListener {
  return {
    protocol: "tcp",
    address: "0.0.0.0",
    port: 3000,
    scope: "public",
    process: "node",
    pid: 10,
    uid: 1000,
    uptimeSeconds: 60,
    cwd: "/home/sandbox/ws/biznagatec-ws/nagabot",
    home: "/home/sandbox",
    command: "node server.js",
    container: null,
    nexusRole: null,
    ...overrides,
  };
}

describe("listenerKind", () => {
  it("calls a non-root HTTP runtime a web app and a root daemon a host service", () => {
    expect(listenerKind(listener())).toBe("app");
    expect(listenerKind(listener({ process: "python3", command: "python3 -m http.server" }))).toBe("app");
    expect(listenerKind(listener({ process: "cupsd", uid: 0 }))).toBe("service");
    expect(listenerKind(listener({ process: "systemd-resolved", uid: 991 }))).toBe("service");
  });

  it("treats any published container port as an app, never as a host service", () => {
    const docker = listener({
      process: "docker-proxy",
      uid: 0,
      container: { id: null, publish: { hostPort: 3210, containerIp: "172.19.0.2", containerPort: 3100 } },
    });
    expect(listenerKind(docker)).toBe("app");
    expect(listenerName(docker)).toBe("Docker container");
    expect(folderDetail(docker)).toBe("Docker · published 3210 → container 172.19.0.2:3100");
  });

  it("names a container by its cgroup id when there is no published mapping", () => {
    const container = listener({ container: { id: "6e778bb38b5e", publish: null }, process: "node", pid: 30 });
    expect(listenerName(container)).toBe("Docker container 6e778bb38b5e");
    expect(folderDetail(container)).toBe("Docker · container 6e778bb38b5e");
  });
});

describe("names and folders", () => {
  it("names a host app by its folder and shortens the path to the owner's home", () => {
    const app = listener();
    expect(listenerName(app)).toBe("nagabot");
    expect(formatFolder(app.cwd, app.home)).toBe("~/ws/biznagatec-ws/nagabot");
    expect(folderDetail(app)).toBe("~/ws/biznagatec-ws/nagabot");
  });

  it("names a host service by its process, not by a daemon's working directory", () => {
    const cupsd = listener({ process: "cupsd", uid: 0, cwd: "/var/snap/cups/1262" });
    expect(listenerName(cupsd)).toBe("cupsd");
    expect(listenerKind(cupsd)).toBe("service");
    expect(listenerName(listener({ process: "systemd-resolved", uid: 991, cwd: "/" }))).toBe("systemd-resolved");
  });

  it("says a column is unreadable instead of printing a dash", () => {
    expect(folderDetail(listener({ cwd: null, home: null }))).toBe("folder not readable for this process");
    expect(folderDetail(listener({ cwd: null, pid: null, process: null }))).toBe("owner not identified");
    expect(listenerName(listener({ cwd: null, process: null, uid: 123 }))).toBe("uid 123");
  });
});

describe("groupListeners", () => {
  it("collapses one process's sockets into a single row with its ports and binds", () => {
    const groups = groupListeners([
      listener({ protocol: "tcp", port: 4446 }),
      listener({ protocol: "udp", port: 4446 }),
      listener({ protocol: "tcp6", port: 4446, address: "::", scope: "public" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: "app",
      name: "nagabot",
      ports: [4446],
      sockets: 3,
      protocols: ["tcp", "udp", "tcp6"],
      scope: "public",
      pids: [10],
    });
  });

  it("drops a runtime line that only repeats the name, keeps one that distinguishes", () => {
    const daemon = groupListeners([
      listener({ process: "systemd-resolved", uid: 991, cwd: "/", command: "/usr/lib/systemd/systemd-resolved" }),
    ]);
    expect(daemon[0]).toMatchObject({ name: "systemd-resolved", kind: "service", runtime: null });

    const python = groupListeners([listener({ process: "python3", command: "python3 -m http.server 4446" })]);
    expect(python[0]?.runtime).toBe("python3 · http.server");
  });
  it("collapses docker-proxy's per-address bindings by the container port they publish", () => {
    const publish = { hostPort: 8787, containerIp: "172.20.0.2", containerPort: 8787 };
    const groups = groupListeners([
      listener({ pid: 20, port: 8787, address: "127.0.0.1", scope: "loopback", container: { id: null, publish } }),
      listener({
        pid: 21,
        port: 8787,
        address: "100.102.151.39",
        scope: "interface",
        container: { id: null, publish },
      }),
      listener({
        pid: 22,
        port: 3000,
        container: { id: null, publish: { ...publish, containerIp: "172.18.0.2", containerPort: 3000 } },
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ ports: [3000], sockets: 1 });
    expect(groups[1]).toMatchObject({
      ports: [8787],
      sockets: 2,
      addresses: ["127.0.0.1", "100.102.151.39"],
      // The widest exposure in the group wins, so a public bind is never hidden.
      scope: "interface",
    });
  });

  it("keeps a listener whose owner could not be named on its own row", () => {
    const groups = groupListeners([
      listener({ pid: null, process: null, port: 9001 }),
      listener({ pid: null, process: null, port: 9002 }),
    ]);
    expect(groups.map((group) => group.key)).toHaveLength(2);
  });
});

describe("summarizeServers", () => {
  it("counts apps, sockets, Docker, and public exposure", () => {
    const summary = summarizeServers([
      listener({ port: 4446, nexusRole: null }),
      listener({ protocol: "udp", port: 4446 }),
      listener({ process: "cupsd", uid: 0, pid: 1, scope: "loopback", cwd: null, home: null }),
      listener({
        uid: 0,
        port: 3210,
        nexusRole: "board",
        container: { id: null, publish: { hostPort: 3210, containerIp: "172.19.0.2", containerPort: 3100 } },
      }),
    ]);

    expect(summary).toEqual({ apps: 2, services: 1, listeners: 4, publicListeners: 3, dockerListeners: 1 });
  });
});

describe("matchesGroupFilter", () => {
  const groups = groupListeners([
    listener({ port: 4446, command: "python3 -m http.server 4446" }),
    listener({
      uid: 0,
      process: "docker-proxy",
      port: 3210,
      cwd: null,
      home: null,
      command: "/usr/bin/docker-proxy -proto tcp -host-port 3210 -container-ip 172.19.0.2 -container-port 3100",
      container: { id: "6e778bb38b5e", publish: { hostPort: 3210, containerIp: "172.19.0.2", containerPort: 3100 } },
    }),
  ]);

  it("searches folder, container, and runtime, not just the port", () => {
    expect(groups.filter((group) => matchesGroupFilter(group, "nagabot"))).toHaveLength(1);
    expect(groups.filter((group) => matchesGroupFilter(group, "6e778bb38b5e"))).toHaveLength(1);
    expect(groups.filter((group) => matchesGroupFilter(group, "172.19.0.2"))).toHaveLength(1);
    expect(groups.filter((group) => matchesGroupFilter(group, "3210"))).toHaveLength(1);
    expect(groups.filter((group) => matchesGroupFilter(group, "nothing"))).toHaveLength(0);
  });
});
