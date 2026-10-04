import { describe, expect, it } from "vitest";

import {
  candidateUrls,
  configPath,
  configUrl,
  describeInstance,
  describeTarget,
  normalizeUrl,
  type Probe,
  parseConfig,
  resolveBoard,
} from "@/cli/board-target";
import type { BoardInstance } from "@/cli/types";

const instance = (overrides: Partial<BoardInstance> = {}): BoardInstance => ({
  dataDir: "/repo/data",
  database: "/repo/data/nexus.db",
  counts: { projects: 3, tasks: 12 },
  ...overrides,
});

/** A probe that answers only for the listed URLs. */
function probeOf(answers: Record<string, BoardInstance | null>): Probe {
  return async (url) => (url in answers ? { reachable: true, instance: answers[url] } : { reachable: false });
}

function configReader(text: string | null) {
  return () => text;
}

describe("parseConfig", () => {
  it("reads KEY=value lines, ignoring comments and blanks", () => {
    expect(parseConfig("# board\n\nNEXUS_URL=http://localhost:3210\nOTHER=1\n")).toEqual({
      NEXUS_URL: "http://localhost:3210",
      OTHER: "1",
    });
  });

  it("accepts export, quotes and surrounding whitespace", () => {
    expect(parseConfig('export NEXUS_URL="http://localhost:3210/"\n')).toEqual({
      NEXUS_URL: "http://localhost:3210/",
    });
    expect(parseConfig("  NEXUS_URL = 'http://host:9'  \n")).toEqual({ NEXUS_URL: "http://host:9" });
  });

  it("skips lines that are not assignments", () => {
    expect(parseConfig("=nope\nnonsense\nNEXUS_URL=http://a\n")).toEqual({ NEXUS_URL: "http://a" });
  });
});

describe("normalizeUrl and configPath", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(normalizeUrl("  http://localhost:3210//  ")).toBe("http://localhost:3210");
  });

  it("honours XDG_CONFIG_HOME and falls back to HOME", () => {
    expect(configPath({ HOME: "/home/me" })).toBe("/home/me/.config/nexus/env");
    expect(configPath({ HOME: "/home/me", XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/nexus/env");
  });
});

describe("configUrl", () => {
  it("returns the configured URL, and null when the file is absent or silent", () => {
    expect(configUrl({ HOME: "/home/me" }, configReader("NEXUS_URL=http://localhost:3210\n"))).toBe(
      "http://localhost:3210",
    );
    expect(configUrl({ HOME: "/home/me" }, configReader("SOMETHING=else\n"))).toBeNull();
    expect(configUrl({ HOME: "/home/me" }, configReader(null))).toBeNull();
  });
});

describe("candidateUrls", () => {
  it("probes the deployed container before the dev server", () => {
    expect(candidateUrls({})).toEqual(["http://localhost:3210", "http://localhost:3100"]);
  });

  it("respects HOST_PORT and de-duplicates", () => {
    expect(candidateUrls({ HOST_PORT: "3100" })).toEqual(["http://localhost:3100", "http://localhost:3210"]);
  });

  it("uses NEXUS_CANDIDATES verbatim when set", () => {
    expect(candidateUrls({ NEXUS_CANDIDATES: "http://box:4000, http://box:4001", HOST_PORT: "3210" })).toEqual([
      "http://box:4000",
      "http://box:4001",
    ]);
  });
});

describe("resolveBoard", () => {
  it("lets NEXUS_URL win without probing anything else", async () => {
    const probed: string[] = [];
    const target = await resolveBoard({
      env: { NEXUS_URL: "http://remote:9999" },
      probe: async (url) => {
        probed.push(url);
        return { reachable: true, instance: instance() };
      },
    });
    expect(target.url).toBe("http://remote:9999");
    expect(target.source).toBe("env");
    expect(target.reachable).toEqual([]);
    expect(probed).toEqual(["http://remote:9999"]);
  });

  it("fails loudly when an explicitly configured board does not answer", async () => {
    await expect(resolveBoard({ env: { NEXUS_URL: "http://remote:9999" }, probe: probeOf({}) })).rejects.toThrow(
      /cannot reach Nexus at http:\/\/remote:9999 \(from NEXUS_URL\)/,
    );
  });

  it("falls back to the machine config when NEXUS_URL is unset", async () => {
    const target = await resolveBoard({
      env: { HOME: "/home/me" },
      read: configReader("NEXUS_URL=http://localhost:3210\n"),
      probe: probeOf({ "http://localhost:3210": instance() }),
    });
    expect(target.source).toBe("config");
    expect(target.url).toBe("http://localhost:3210");
  });

  it("reports a configured-but-dead board by its config file", async () => {
    await expect(
      resolveBoard({
        env: { HOME: "/home/me" },
        read: configReader("NEXUS_URL=http://localhost:3210\n"),
        probe: probeOf({}),
      }),
    ).rejects.toThrow(/from \/home\/me\/\.config\/nexus\/env/);
  });

  it("probes in order and keeps the first board that answers", async () => {
    const target = await resolveBoard({
      env: {},
      candidates: ["http://localhost:3210", "http://localhost:3100"],
      probe: probeOf({ "http://localhost:3100": instance({ database: "/repo/data-dev/nexus.db" }) }),
    });
    expect(target.url).toBe("http://localhost:3100");
    expect(target.source).toBe("probe");
    expect(target.reachable).toEqual(["http://localhost:3100"]);
    expect(target.instance?.database).toBe("/repo/data-dev/nexus.db");
  });

  it("lists every board that answered, first one winning", async () => {
    const target = await resolveBoard({
      env: {},
      candidates: ["http://localhost:3210", "http://localhost:3100"],
      probe: probeOf({ "http://localhost:3210": instance(), "http://localhost:3100": instance() }),
    });
    expect(target.reachable).toEqual(["http://localhost:3210", "http://localhost:3100"]);
    expect(target.url).toBe("http://localhost:3210");
  });

  it("keeps a board that answers without identity (pre-/api/instance build)", async () => {
    const target = await resolveBoard({
      env: {},
      candidates: ["http://localhost:3210"],
      probe: probeOf({ "http://localhost:3210": null }),
    });
    expect(target.instance).toBeNull();
    expect(describeTarget(target)).toContain("identity unknown");
  });

  it("names every candidate and the fix when nothing answers", async () => {
    await expect(
      resolveBoard({
        env: { HOME: "/home/me" },
        candidates: ["http://localhost:3210", "http://localhost:3100"],
        probe: probeOf({}),
      }),
    ).rejects.toThrow(/no Nexus board answered at http:\/\/localhost:3210, http:\/\/localhost:3100.*NEXUS_URL/s);
  });
});

describe("describeInstance", () => {
  it("names the database file and what lives in it", () => {
    expect(describeInstance(instance())).toBe("/repo/data/nexus.db · 12 tasks / 3 projects");
  });

  it("says what is unknown instead of inventing it", () => {
    expect(describeInstance({ dataDir: "/repo/data", database: null, counts: { projects: 0, tasks: null } })).toBe(
      "/repo/data · tasks unknown / 0 projects",
    );
    expect(describeInstance(null)).toContain("identity unknown");
  });
});
