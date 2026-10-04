"use client";

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import type { ProjectDto } from "@/lib/dto";

/** Create/edit form for a project (name, folder, optional Herdr workspace). */
export function ProjectFormDialog({
  project,
  onOpenChange,
  onSaved,
}: {
  project: ProjectDto | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (project: ProjectDto) => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [folderPath, setFolderPath] = useState(project?.folderPath ?? "");
  const [herdrWorkspaceId, setHerdrWorkspaceId] = useState(project?.herdrWorkspaceId ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const body = JSON.stringify({
        name,
        folderPath: folderPath.trim() === "" ? null : folderPath,
        herdrWorkspaceId: herdrWorkspaceId.trim() === "" ? null : herdrWorkspaceId,
      });
      const saved = project
        ? await apiFetch<ProjectDto>(`/api/projects/${project.id}`, { method: "PATCH", body })
        : await apiFetch<ProjectDto>("/api/projects", { method: "POST", body });
      onSaved(saved);
      toast.success(project ? "Project updated" : "Project created");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>A project lives in one folder and may map to one Herdr workspace.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              placeholder="crm development"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-folder">Folder path</Label>
            <Input
              id="project-folder"
              value={folderPath}
              placeholder="~/ws/biznagatec-crm"
              onChange={(event) => setFolderPath(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-workspace">Herdr workspace id</Label>
            <Input
              id="project-workspace"
              value={herdrWorkspaceId}
              placeholder="wP"
              onChange={(event) => setHerdrWorkspaceId(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving || name.trim() === ""} onClick={submit}>
            {saving ? "Saving…" : project ? "Save" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
