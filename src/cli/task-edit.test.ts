import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CliError, parseArgs, parseDescription } from "@/cli/nx";

describe("nx task edit parsing", () => {
  it("parses task edit arguments and flags", () => {
    const { positionals, flags } = parseArgs([
      "task",
      "edit",
      "c039ba5b",
      "--title",
      "New Title",
      "--status",
      "ready",
      "--priority",
      "high",
      "--project",
      "nexus",
    ]);

    expect(positionals).toEqual(["task", "edit", "c039ba5b"]);
    expect(flags.get("title")).toBe("New Title");
    expect(flags.get("status")).toBe("ready");
    expect(flags.get("priority")).toBe("high");
    expect(flags.get("project")).toBe("nexus");
  });

  describe("parseDescription", () => {
    it("returns undefined when null", () => {
      expect(parseDescription(null)).toBeUndefined();
    });

    it("returns null when empty or whitespace", () => {
      expect(parseDescription("")).toBeNull();
      expect(parseDescription("   ")).toBeNull();
    });

    it("unescapes escaped newlines into real newlines", () => {
      expect(parseDescription("line 1\\nline 2\\nline 3")).toBe("line 1\nline 2\nline 3");
    });

    it("reads multiline content from file via @path", () => {
      const tempFile = path.join(os.tmpdir(), `desc-test-${Date.now()}.txt`);
      fs.writeFileSync(tempFile, "First line\nSecond line\nThird line");
      try {
        expect(parseDescription(`@${tempFile}`)).toBe("First line\nSecond line\nThird line");
      } finally {
        fs.unlinkSync(tempFile);
      }
    });

    it("throws CliError when file does not exist", () => {
      expect(() => parseDescription("@/nonexistent/file/path.txt")).toThrow(CliError);
    });
  });
});
