"use client";

import { FolderGit2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { ProjectDto } from "@/lib/dto";

import { PageHeader } from "../../_components/page-header";
import { ProjectFormDialog } from "./project-form-dialog";

export type ProjectStats = { open: number; total: number; needsHuman: number };

const EMPTY_STATS: ProjectStats = { open: 0, total: 0, needsHuman: 0 };

/** Projects are tags on cards; this screen is the cheap overview of their folders and load. */
export function ProjectsClient({
  initialProjects,
  stats,
}: {
  initialProjects: ProjectDto[];
  stats: Record<string, ProjectStats>;
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [form, setForm] = useState<{ open: boolean; project: ProjectDto | null }>({ open: false, project: null });

  function upsert(project: ProjectDto) {
    setProjects((list) =>
      list.some((item) => item.id === project.id)
        ? list.map((item) => (item.id === project.id ? project : item))
        : [...list, project],
    );
  }

  async function remove(project: ProjectDto) {
    if (!window.confirm(`Delete "${project.name}"? Its tasks stay, without a project tag.`)) return;
    try {
      await apiFetch(`/api/projects/${project.id}`, { method: "DELETE" });
      setProjects((list) => list.filter((item) => item.id !== project.id));
      toast.success("Project deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the project");
    }
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project lives in one folder and may map to one Herdr workspace."
        actions={
          <Button size="sm" onClick={() => setForm({ open: true, project: null })}>
            <Plus />
            New project
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {projects.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No projects yet. Create one, or leave tasks project-less in the inbox.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const projectStats = stats[project.id] ?? EMPTY_STATS;
              return (
                <article key={project.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start gap-2">
                    <FolderGit2 className="mt-0.5 size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold">{project.name}</h2>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {project.folderPath ?? "no folder"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit project"
                        onClick={() => setForm({ open: true, project })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete project"
                        onClick={() => remove(project)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">{projectStats.open} open</Badge>
                    <Badge variant="outline">{projectStats.total} total</Badge>
                    {projectStats.needsHuman > 0 ? (
                      <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300">
                        {projectStats.needsHuman} need you
                      </Badge>
                    ) : null}
                    {project.herdrWorkspaceId ? (
                      <Badge variant="ghost" className="font-mono text-muted-foreground">
                        {project.herdrWorkspaceId}
                      </Badge>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {form.open ? (
        <ProjectFormDialog
          key={form.project?.id ?? "new"}
          project={form.project}
          onOpenChange={(open) => setForm((current) => ({ ...current, open }))}
          onSaved={upsert}
        />
      ) : null}
    </>
  );
}
