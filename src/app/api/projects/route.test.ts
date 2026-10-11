import { beforeEach, describe, expect, it, vi } from "vitest";

import { type CreateProjectInput, createProject, type Project } from "@/domain/projects/project";
import type { ProjectRepository } from "@/domain/projects/project.repository";

const state = vi.hoisted(() => {
  const projects: Project[] = [];
  const projectRepo: ProjectRepository = {
    findById: async (id) => projects.find((project) => project.id === id) ?? null,
    findAll: async () => [...projects],
    save: async (input: CreateProjectInput) => {
      const project = createProject(input);
      projects.push(project);
      return project;
    },
    update: async () => {
      throw new Error("not used");
    },
    delete: async () => {
      throw new Error("not used");
    },
  };
  return { projects, projectRepo };
});

vi.mock("@/infrastructure/container", () => ({
  projectRepo: state.projectRepo,
}));

import { POST } from "@/app/api/projects/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/projects", () => {
  beforeEach(() => {
    state.projects.length = 0;
  });

  it("returns 400 and does not insert a second row when the name already exists", async () => {
    const created = await POST(jsonRequest({ name: "joma", folderPath: "/old", herdrWorkspaceId: "wV" }));
    expect(created.status).toBe(201);

    const refused = await POST(jsonRequest({ name: "JOMA", folderPath: "/new", herdrWorkspaceId: "wW" }));
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { data: null; error: string };
    expect(body.data).toBeNull();
    expect(body.error).toBe(
      'A project named "joma" already exists. Use `nx project edit` to change its folder or workspace.',
    );
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0]?.folderPath).toBe("/old");
    expect(state.projects[0]?.herdrWorkspaceId).toBe("wV");
  });
});
