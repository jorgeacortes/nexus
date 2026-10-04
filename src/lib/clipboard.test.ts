import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "@/lib/clipboard";

type FakeTextArea = { value: string; focus: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

/** Minimal stand-in for the DOM bits the legacy copy path touches. */
function stubLegacyDocument({ execResult = true, insideDialog = false } = {}) {
  const execCommand = vi.fn(() => execResult);
  const textareas: FakeTextArea[] = [];
  const dialogAppend = vi.fn();
  const bodyAppend = vi.fn();
  const dialog = { appendChild: dialogAppend };
  const doc = {
    body: { appendChild: bodyAppend },
    activeElement: insideDialog ? { closest: vi.fn(() => dialog) } : null,
    createElement(_tag: string) {
      const node = {
        value: "",
        style: {} as Record<string, string>,
        setAttribute: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
        remove: vi.fn(),
      };
      textareas.push(node);
      return node;
    },
    execCommand,
  };
  vi.stubGlobal("document", doc);
  return { execCommand, textareas, bodyAppend, dialogAppend };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("uses the async clipboard when the context is secure", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { execCommand, bodyAppend } = stubLegacyDocument();

    await expect(copyText("728c9d79-85d0-4eca-b19a-7887f40b9ae2")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("728c9d79-85d0-4eca-b19a-7887f40b9ae2");
    expect(execCommand).not.toHaveBeenCalled();
    expect(bodyAppend).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the async clipboard rejects (insecure http)", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("not allowed");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { execCommand, textareas, bodyAppend } = stubLegacyDocument();

    await expect(copyText("task-1")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textareas[0]?.value).toBe("task-1");
    expect(textareas[0]?.focus).toHaveBeenCalled();
    expect(textareas[0]?.remove).toHaveBeenCalled();
    expect(bodyAppend).toHaveBeenCalledTimes(1);
  });

  it("parks the textarea inside an open dialog so the modal's focus trap cannot drop the selection", async () => {
    vi.stubGlobal("navigator", {});
    const { execCommand, bodyAppend, dialogAppend } = stubLegacyDocument({ insideDialog: true });

    await expect(copyText("task-2")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(dialogAppend).toHaveBeenCalledTimes(1);
    expect(bodyAppend).not.toHaveBeenCalled();
  });

  it("falls back when navigator.clipboard is missing entirely", async () => {
    vi.stubGlobal("navigator", {});
    const { execCommand } = stubLegacyDocument();

    await expect(copyText("task-3")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure instead of throwing when nothing can copy", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", undefined);

    await expect(copyText("task-4")).resolves.toBe(false);
  });

  it("reports failure when execCommand refuses, and still cleans up the textarea", async () => {
    vi.stubGlobal("navigator", {});
    const { textareas } = stubLegacyDocument({ execResult: false });

    await expect(copyText("task-5")).resolves.toBe(false);
    expect(textareas[0]?.remove).toHaveBeenCalled();
  });
});
