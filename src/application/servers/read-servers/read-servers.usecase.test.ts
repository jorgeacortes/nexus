import { describe, expect, it } from "vitest";

import { ReadServersUseCase } from "@/application/servers/read-servers";
import type { ContainerIdentity, ContainerInventoryPort } from "@/infrastructure/docker/container-inventory";
import type {
  HostListener,
  HostListenersSnapshot,
  ServerCollectorPort,
} from "@/infrastructure/servers/server-collector";

function collectorOf(snapshot: HostListenersSnapshot): ServerCollectorPort {
  return { collect: async () => snapshot };
}

function inventoryOf(containers: ContainerIdentity[]): ContainerInventoryPort {
  return { collect: async () => containers };
}

const NO_CONTAINERS: ContainerInventoryPort = { collect: async () => [] };

const nexusPorts = { board: 3210, dev: 3100 };

function listener(overrides: Partial<HostListener> = {}): HostListener {
  return {
    protocol: "tcp",
    address: "0.0.0.0",
    port: 3000,
    scope: "public",
    process: "node",
    pid: 42,
    uid: 1000,
    uptimeSeconds: 120,
    cwd: "/home/sandbox/ws/nagabot",
    home: "/home/sandbox",
    command: "node server.js",
    container: null,
    ...overrides,
  };
}

function snapshot(listeners: HostListener[]): HostListenersSnapshot {
  return { collectedAt: "2026-10-04T09:00:00.000Z", listeners };
}

describe("ReadServersUseCase", () => {
  it("marks Nexus' own ports and leaves the rest alone", async () => {
    const useCase = new ReadServersUseCase(
      collectorOf(snapshot([listener({ port: 3210 }), listener({ port: 3100 }), listener({ port: 8787 })])),
      nexusPorts,
      NO_CONTAINERS,
    );

    const payload = await useCase.execute();
    expect(payload.available).toBe(true);
    expect(payload.error).toBeNull();
    expect(payload.listeners.map((entry) => entry.nexusRole)).toEqual(["board", "dev", null]);
  });

  it("reports an empty host as available, not as a failure", async () => {
    const useCase = new ReadServersUseCase(collectorOf(snapshot([])), nexusPorts, NO_CONTAINERS);

    const payload = await useCase.execute();
    expect(payload).toMatchObject({ available: true, error: null, listeners: [] });
    expect(payload.docker).toEqual({ available: true, error: null });
  });

  it("turns a collector failure into available: false with the reason", async () => {
    const useCase = new ReadServersUseCase(
      {
        collect: async () => {
          throw new Error("Cannot read host sockets at /proc/1/net/tcp: EACCES");
        },
      },
      nexusPorts,
      NO_CONTAINERS,
    );

    const payload = await useCase.execute();
    expect(payload.available).toBe(false);
    expect(payload.listeners).toEqual([]);
    expect(payload.error).toMatch(/EACCES/);
    expect(payload.docker).toEqual({ available: false, error: null });
  });

  it("joins a published port to its container by the docker-proxy container ip", async () => {
    const useCase = new ReadServersUseCase(
      collectorOf(
        snapshot([
          listener({
            port: 8787,
            pid: 3171115,
            process: "docker-proxy",
            uid: 0,
            cwd: null,
            home: null,
            container: {
              id: null,
              publish: { hostPort: 8787, containerIp: "172.20.0.2", containerPort: 8787 },
            },
          }),
        ]),
      ),
      nexusPorts,
      inventoryOf([
        {
          id: "6e778bb38b5e",
          name: "nagabot-web-1",
          image: "nagabot",
          composeProject: "nagabot",
          composeService: "web",
          workingDir: "/home/sandbox/ws/biznagatec-ws/nagabot",
          ips: ["172.20.0.2", "172.21.0.9"],
        },
      ]),
    );

    const payload = await useCase.execute();
    expect(payload.docker).toEqual({ available: true, error: null });
    expect(payload.listeners[0]?.container).toEqual({
      id: null,
      publish: { hostPort: 8787, containerIp: "172.20.0.2", containerPort: 8787 },
      name: "nagabot-web-1",
      image: "nagabot",
      composeProject: "nagabot",
      composeService: "web",
      workingDir: "/home/sandbox/ws/biznagatec-ws/nagabot",
    });
  });

  it("joins a container-run listener by the id its cgroup names", async () => {
    const useCase = new ReadServersUseCase(
      collectorOf(
        snapshot([
          listener({
            port: 9000,
            container: { id: "6e778bb38b5e", publish: null },
          }),
        ]),
      ),
      nexusPorts,
      inventoryOf([
        {
          id: "6e778bb38b5e",
          name: "nexus-nexus-1",
          image: "nexus:latest",
          composeProject: "nexus",
          composeService: "nexus",
          workingDir: null,
          ips: [],
        },
      ]),
    );

    const payload = await useCase.execute();
    expect(payload.listeners[0]?.container?.name).toBe("nexus-nexus-1");
  });

  it("degrades to the procfs facts, never a guessed name, when the proxy is down", async () => {
    const useCase = new ReadServersUseCase(
      collectorOf(
        snapshot([
          listener({
            port: 3210,
            pid: 1,
            process: "docker-proxy",
            uid: 0,
            cwd: null,
            home: null,
            container: { id: null, publish: { hostPort: 3210, containerIp: "172.19.0.2", containerPort: 3100 } },
          }),
        ]),
      ),
      nexusPorts,
      {
        collect: async () => {
          throw new Error("Docker API /containers/json failed: HTTP 403");
        },
      },
    );

    const payload = await useCase.execute();
    expect(payload.available).toBe(true);
    expect(payload.docker).toEqual({ available: false, error: "Docker API /containers/json failed: HTTP 403" });
    expect(payload.listeners[0]?.container).toMatchObject({
      name: null,
      image: null,
      composeProject: null,
      publish: { containerIp: "172.19.0.2" },
    });
  });
});
