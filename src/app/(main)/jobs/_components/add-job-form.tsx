"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import type { ProjectDto } from "@/lib/dto";

/** Adds one schedule job. A cron expression wins over the interval. */
export function AddJobForm({ projects }: { projects: ProjectDto[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const prompt = String(data.get("prompt") ?? "").trim();
    const schedule = String(data.get("schedule") ?? "").trim();
    const intervalRaw = String(data.get("intervalSeconds") ?? "").trim();
    const projectId = String(data.get("projectId") ?? "").trim();
    const intervalSeconds = intervalRaw ? Number(intervalRaw) : null;
    setPending(true);
    try {
      await apiFetch("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          name,
          prompt,
          schedule: schedule || null,
          intervalSeconds: schedule ? null : intervalSeconds,
          projectId: projectId || null,
          targetMode: "reuse",
        }),
      });
      toast.success(`"${name}" is on the schedule`);
      form.reset();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the job");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-6 grid gap-3 rounded-xl border border-border p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="job-name">Name</Label>
          <Input id="job-name" name="name" required placeholder="Morning board check" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="job-project">Project</Label>
          <NativeSelect id="job-project" name="projectId" defaultValue="">
            <NativeSelectOption value="">None</NativeSelectOption>
            {projects.map((project) => (
              <NativeSelectOption key={project.id} value={project.id}>
                {project.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="job-prompt">Prompt</Label>
        <Textarea id="job-prompt" name="prompt" required rows={3} placeholder="What the agent should do." />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="job-schedule">Cron schedule</Label>
          <Input id="job-schedule" name="schedule" placeholder="0 9 * * * (optional)" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="job-interval">Or interval (seconds)</Label>
          <Input id="job-interval" name="intervalSeconds" type="number" min={1} step={1} placeholder="3600" />
        </div>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding..." : "Add job"}
        </Button>
      </div>
    </form>
  );
}
