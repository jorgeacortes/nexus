import { describe, expect, it } from "vitest";

import { modelLabel, normalizeEffort, normalizeModelId } from "@/domain/tasks/model";

describe("normalizeModelId", () => {
  it("strips a provider prefix that the harness prints", () => {
    expect(normalizeModelId("opencode-go/deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
    expect(normalizeModelId("deepseek/deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
  });

  it("keeps a harness-native id as it is, lowercased", () => {
    expect(normalizeModelId("deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
    expect(normalizeModelId("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(normalizeModelId("GROK-4.7")).toBe("grok-4.7");
  });

  it("maps Herdr display labels onto registry ids", () => {
    expect(normalizeModelId("Claude/Sonnet 5.5")).toBe("claude-sonnet-5-5");
    expect(normalizeModelId("Sonnet 5.5")).toBe("claude-sonnet-5-5");
    expect(normalizeModelId("Claude/Opus 5.5")).toBe("claude-opus-5-5");
    expect(normalizeModelId("Grok 4.7 256K High")).toBe("grok-4.7");
  });

  it("maps the historical dotted Claude ids onto the live spelling", () => {
    expect(normalizeModelId("claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(normalizeModelId("claude-opus-5.5")).toBe("claude-opus-5-5");
  });

  it("passes an unknown value through rather than rejecting it", () => {
    expect(normalizeModelId("some/never-seen-model-9")).toBe("never-seen-model-9");
  });

  it("returns null for empty input", () => {
    expect(normalizeModelId(null)).toBeNull();
    expect(normalizeModelId("   ")).toBeNull();
  });
});

describe("normalizeEffort", () => {
  it("lowercases and maps the spellings harnesses print", () => {
    expect(normalizeEffort("High")).toBe("high");
    expect(normalizeEffort("x-high")).toBe("xhigh");
  });

  it("treats off/none as no effort and unknown values as absent", () => {
    expect(normalizeEffort("off")).toBeNull();
    expect(normalizeEffort("none")).toBeNull();
    expect(normalizeEffort("")).toBeNull();
    expect(normalizeEffort(null)).toBeNull();
  });
});

describe("modelLabel", () => {
  it("renders known ids readably and falls back to the id", () => {
    expect(modelLabel("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(modelLabel("deepseek-v4.1-flash")).toBe("DeepSeek V4.1 Flash");
    expect(modelLabel("mystery-model")).toBe("mystery-model");
  });
});
