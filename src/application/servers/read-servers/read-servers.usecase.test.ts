import { describe, expect, it } from "vitest";

import { ReadServersUseCase } from "@/application/servers/read-servers";
import type { HostListenersSnapshot, ServerCollectorPort } from "@/infrastructure/servers/server-collector";

function collectorOf(snapshot: HostListenersSnapshot): ServerCollectorPort {
  return { collect: async () => snapshot };
}

const nexusPorts = { board: 3210, dev: 3100 };

function listener(port: number) {
  return {
    protocol: "tcp" as const,
    address: "0.0.0.0",
    port,
    scope: "public" as const,
    process: "node",
    pid: 42,
    uid: 1000,
    uptimeSeconds: 120,
  };
}

describe("ReadServersUseCase", () => {
  it("marks Nexus' own ports and leaves the rest alone", async () => {
    const useCase = new ReadServersUseCase(
      collectorOf({
        collectedAt: "2026-10-04T09:00:00.000Z",
        listeners: [listener(3210), listener(3100), listener(8787)],
      }),
      nexusPorts,
    );

    const payload = await useCase.execute();
    expect(payload.available).toBe(true);
    expect(payload.error).toBeNull();
    expect(payload.listeners.map((entry) => entry.nexusRole)).toEqual(["board", "dev", null]);
  });

  it("reports an empty host as available, not as a failure", async () => {
    const useCase = new ReadServersUseCase(
      collectorOf({ collectedAt: "2026-10-04T09:00:00.000Z", listeners: [] }),
      nexusPorts,
    );

    const payload = await useCase.execute();
    expect(payload).toMatchObject({ available: true, error: null, listeners: [] });
  });

  it("turns a collector failure into available: false with the reason", async () => {
    const useCase = new ReadServersUseCase(
      {
        collect: async () => {
          throw new Error("Cannot read host sockets at /proc/1/net/tcp: EACCES");
        },
      },
      nexusPorts,
    );

    const payload = await useCase.execute();
    expect(payload.available).toBe(false);
    expect(payload.listeners).toEqual([]);
    expect(payload.error).toMatch(/EACCES/);
  });
});
