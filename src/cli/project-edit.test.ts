import { describe, expect, it } from "vitest";

import { CliError, parseArgs, projectEditBody } from "@/cli/nx";

function flagsOf(argv: string[]) {
  return parseArgs(argv).flags;
}

describe("projectEditBody", () => {
  it("sends only the fields the operator passed", () => {
    expect(projectEditBody(flagsOf(["--workspace", "wW"]))).toEqual({ herdrWorkspaceId: "wW" });
    expect(projectEditBody(flagsOf(["--folder", "/home/sandbox/ws/joma"]))).toEqual({
      folderPath: "/home/sandbox/ws/joma",
    });
    expect(projectEditBody(flagsOf(["--name", "joma"]))).toEqual({ name: "joma" });
  });

  it("combines several fields in one PATCH", () => {
    expect(projectEditBody(flagsOf(["--name", "joma", "--workspace", "wW", "--folder", "/x"]))).toEqual({
      name: "joma",
      herdrWorkspaceId: "wW",
      folderPath: "/x",
    });
  });

  it("clears a nullable field with -, none, or an empty value", () => {
    expect(projectEditBody(flagsOf(["--workspace", "-"]))).toEqual({ herdrWorkspaceId: null });
    expect(projectEditBody(flagsOf(["--workspace", "none"]))).toEqual({ herdrWorkspaceId: null });
    expect(projectEditBody(flagsOf(["--folder", "-"]))).toEqual({ folderPath: null });
  });

  it("refuses when nothing would change", () => {
    expect(() => projectEditBody(flagsOf([]))).toThrow(CliError);
  });

  it("trims the workspace id so a stray space is not persisted", () => {
    expect(projectEditBody(flagsOf(["--workspace", "  wW  "]))).toEqual({ herdrWorkspaceId: "wW" });
  });
});
