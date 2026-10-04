import { describe, expect, it } from "vitest";

import { buildDispatchPrompt } from "@/domain/tasks/dispatch-prompt";
import { createTask } from "@/domain/tasks/task";

describe("buildDispatchPrompt", () => {
  it("names the task, the project folder, and the claim/complete commands", () => {
    const task = createTask({ title: "wire TAVILY", description: "use the search provider" });
    const prompt = buildDispatchPrompt(task, { name: "crm development", folderPath: "~/ws/biznagatec-crm" });

    expect(prompt).toContain(`#${task.id.slice(0, 8)} — wire TAVILY`);
    expect(prompt).toContain("Project: crm development (~/ws/biznagatec-crm)");
    expect(prompt).toContain("use the search provider");
    expect(prompt).toContain(`nx claim ${task.id}`);
    expect(prompt).toContain(`nx done ${task.id}`);
    expect(prompt).toContain(`nx need ${task.id}`);
  });

  it("degrades when the task has no project or description", () => {
    const prompt = buildDispatchPrompt(createTask({ title: "solo" }), null);
    expect(prompt).toContain("Project: none");
    expect(prompt).not.toContain("undefined");
  });
});
