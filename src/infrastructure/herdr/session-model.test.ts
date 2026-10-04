import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveObservedModel } from "@/infrastructure/herdr/session-model";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-harness-"));
  process.env.HARNESS_STATE_DIR = root;
});

afterEach(() => {
  delete process.env.HARNESS_STATE_DIR;
  rmSync(root, { recursive: true, force: true });
});

function writePiSession(lines: string[]): string {
  const path = join(root, "pi", "sessions", "--ws--", "session.jsonl");
  mkdirSync(join(root, "pi", "sessions", "--ws--"), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

describe("resolveObservedModel", () => {
  it("reads pi's model and thinking level from the session transcript", async () => {
    const path = writePiSession([
      JSON.stringify({ type: "session", id: "x" }),
      JSON.stringify({ type: "message", provider: "opencode-go", modelId: "deepseek-v4.1-flash" }),
      JSON.stringify({ type: "message", thinkingLevel: "high" }),
    ]);
    const observed = await resolveObservedModel({
      harness: "pi",
      session: { agent: "pi", kind: "path", source: "herdr:pi", value: path },
      quotaModel: "opencode-go/deepseek-v4.1-flash",
      quotaEffort: null,
    });
    expect(observed).toEqual({ model: "deepseek-v4.1-flash", effort: "high", source: "session" });
  });

  it("reads Claude Code's model and effort from the session transcript", async () => {
    const id = "6c9d1a47-75a9-49bc-9466-abded57d5d55";
    const dir = join(root, "claude", "projects", "-home-sandbox-ws");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.jsonl`),
      [
        JSON.stringify({ type: "mode", mode: "default" }),
        JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5-5" }, effort: "high" }),
      ].join("\n"),
    );
    const observed = await resolveObservedModel({
      harness: "claude_code",
      session: { agent: "claude", kind: "id", source: "herdr:claude", value: id },
      quotaModel: "Claude/Sonnet 5.5",
      quotaEffort: null,
    });
    expect(observed).toEqual({ model: "claude-sonnet-5-5", effort: "high", source: "session" });
  });

  it("falls back to Claude Code's per-model settings effort", async () => {
    const id = "abc";
    const dir = join(root, "claude", "projects", "-ws");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.jsonl`),
      `${JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5" } })}\n`,
    );
    writeFileSync(
      join(root, "claude", "settings.json"),
      JSON.stringify({ modelSettings: { "claude-opus-5-5": { effortLevel: "medium" } } }),
    );
    const observed = await resolveObservedModel({
      harness: "claude_code",
      session: { agent: "claude", kind: "id", source: "herdr:claude", value: id },
      quotaModel: null,
      quotaEffort: null,
    });
    expect(observed.effort).toBe("medium");
  });

  it("reads Cursor's per-session model instead of the Herdr label", async () => {
    const id = "350a2ae2-3a4e-46a2-860a-ebc6c9f01e95";
    const dir = join(root, "cursor", "chats", "c2318ce3", id);
    mkdirSync(dir, { recursive: true });
    const db = new Database(join(dir, "store.db"));
    db.exec("create table meta (key text, value text)");
    db.prepare("insert into meta (key, value) values (?, ?)").run(
      "0",
      Buffer.from(JSON.stringify({ lastUsedModel: "grok-4.7" })).toString("hex"),
    );
    db.close();
    writeFileSync(
      join(root, "cursor", "cli-config.json"),
      JSON.stringify({ modelParameters: { "grok-4.7": [{ id: "reasoning_effort", value: "high" }] } }),
    );

    const observed = await resolveObservedModel({
      harness: "cursor",
      session: { agent: "cursor", kind: "id", source: "herdr:cursor", value: id },
      // What Herdr actually reports for this live pane — and it is wrong.
      quotaModel: "Claude/Sonnet 5.5",
      quotaEffort: null,
    });
    expect(observed).toEqual({ model: "grok-4.7", effort: "high", source: "session" });
  });

  it("falls back to the normalised Herdr label when the session cannot be read", async () => {
    const observed = await resolveObservedModel({
      harness: "cursor",
      session: null,
      quotaModel: "Claude/Sonnet 5.5",
      quotaEffort: "high",
    });
    expect(observed).toEqual({ model: "claude-sonnet-5-5", effort: "high", source: "quota" });
  });

  it("reports nothing when neither source has a model", async () => {
    const observed = await resolveObservedModel({
      harness: "agy",
      session: { agent: "agy", kind: "id", source: "herdr:agy", value: "nope" },
      quotaModel: null,
      quotaEffort: null,
    });
    expect(observed).toEqual({ model: null, effort: null, source: null });
  });
});
