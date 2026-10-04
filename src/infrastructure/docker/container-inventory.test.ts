import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { HttpContainerInventory } from "@/infrastructure/docker/container-inventory";

interface FakeDocker {
  baseUrl: string;
  calls: string[];
  close: () => Promise<void>;
}

const open: FakeDocker[] = [];

/** A one-route-fits-all Docker API stub that records every path it was asked for. */
async function fakeDocker(handler: (path: string, res: ServerResponse) => void): Promise<FakeDocker> {
  const calls: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? "";
    calls.push(path);
    handler(path, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const fake: FakeDocker = {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  open.push(fake);
  return fake;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((fake) => fake.close()));
});

describe("HttpContainerInventory", () => {
  it("reads name, compose identity, working dir and network IPs", async () => {
    const docker = await fakeDocker((_path, res) =>
      send(res, 200, [
        {
          Id: "6e778bb38b5e2c3767287b198fe170cde8109ba83584ddcd8fe835e898d8e059",
          Names: ["/nexus-nexus-1"],
          Image: "nexus:latest",
          Labels: {
            "com.docker.compose.project": "nexus",
            "com.docker.compose.service": "nexus",
            "com.docker.compose.project.working_dir": "/home/sandbox/ws/biznagatec-ws/nexus",
          },
          NetworkSettings: { Networks: { nexus_default: { IPAddress: "172.19.0.2" }, other: { IPAddress: "" } } },
        },
      ]),
    );

    const containers = await new HttpContainerInventory({ baseUrl: docker.baseUrl }).collect();

    expect(docker.calls).toEqual(["/containers/json"]);
    expect(containers).toEqual([
      {
        id: "6e778bb38b5e",
        name: "nexus-nexus-1",
        image: "nexus:latest",
        composeProject: "nexus",
        composeService: "nexus",
        workingDir: "/home/sandbox/ws/biznagatec-ws/nexus",
        ips: ["172.19.0.2"],
      },
    ]);
  });

  it("resolves a sha-only image through one inspect and caches it across collects", async () => {
    const docker = await fakeDocker((path, res) => {
      if (path === "/containers/json") {
        return send(res, 200, [
          { Id: "aaaaaaaaaaaabbbbbbbbbbbb", Names: ["/nagabot-web-1"], Image: "sha256:deadbeef", Labels: {} },
        ]);
      }
      return send(res, 200, { Config: { Image: "nagabot" } });
    });

    const inventory = new HttpContainerInventory({ baseUrl: docker.baseUrl });
    expect((await inventory.collect())[0]?.image).toBe("nagabot");
    expect((await inventory.collect())[0]?.image).toBe("nagabot");

    const inspects = docker.calls.filter((path) => path.startsWith("/containers/aaaa"));
    expect(inspects).toHaveLength(1);
  });

  it("keeps a container when the inspect for its image fails", async () => {
    const docker = await fakeDocker((path, res) => {
      if (path === "/containers/json") {
        return send(res, 200, [{ Id: "ccccccccccccdddddddddddd", Names: ["/gone"], Image: "sha256:x", Labels: {} }]);
      }
      return send(res, 404, { message: "No such container" });
    });

    const containers = await new HttpContainerInventory({ baseUrl: docker.baseUrl }).collect();
    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({ id: "cccccccccccc", name: "gone", image: null });
  });

  it("throws with the status when the proxy refuses the call", async () => {
    const docker = await fakeDocker((_path, res) => send(res, 403, { message: "Forbidden" }));
    await expect(new HttpContainerInventory({ baseUrl: docker.baseUrl }).collect()).rejects.toThrow(/HTTP 403/);
  });

  it("names the proxy when it cannot be reached", async () => {
    const docker = await fakeDocker((_path, res) => send(res, 200, []));
    await docker.close();
    open.splice(open.indexOf(docker), 1);
    await expect(new HttpContainerInventory({ baseUrl: docker.baseUrl }).collect()).rejects.toThrow(
      /Docker API proxy unreachable at http:\/\/127\.0\.0\.1:\d+/,
    );
  });

  it("skips summaries without an id", async () => {
    const docker = await fakeDocker((_path, res) => send(res, 200, [{ Names: ["/nameless"] }, { Id: "dddddddddddd" }]));
    const containers = await new HttpContainerInventory({ baseUrl: docker.baseUrl }).collect();
    expect(containers.map((container) => container.id)).toEqual(["dddddddddddd"]);
  });
});
