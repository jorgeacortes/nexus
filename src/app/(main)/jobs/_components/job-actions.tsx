"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import type { JobDto } from "@/lib/dto";

/** Pause, resume, run now, or remove one job. A dead job's run revives it. */
export function JobActions({ job }: { job: JobDto }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function act(label: string, path: string, body: unknown, success: string) {
    setPending(label);
    try {
      await apiFetch(path, { method: path.endsWith("/run") ? "POST" : "PATCH", body: JSON.stringify(body) });
      toast.success(success);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the job");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {job.state === "active" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={() => act("pause", `/api/jobs/${job.id}`, { action: "pause" }, `"${job.name}" is paused`)}
        >
          {pending === "pause" ? "Pausing..." : "Pause"}
        </Button>
      ) : null}
      {job.state === "paused" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={() => act("resume", `/api/jobs/${job.id}`, { action: "resume" }, `"${job.name}" is active`)}
        >
          {pending === "resume" ? "Resuming..." : "Resume"}
        </Button>
      ) : null}
      {job.state !== "paused" ? (
        <Button
          type="button"
          size="sm"
          disabled={pending !== null}
          onClick={() =>
            act(
              "run",
              `/api/jobs/${job.id}/run`,
              {},
              job.state === "dead" ? `"${job.name}" is running again` : `"${job.name}" ran`,
            )
          }
        >
          {pending === "run" ? "Running..." : "Run now"}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending !== null}
        onClick={() => {
          if (!window.confirm(`Remove "${job.name}" and its run history?`)) return;
          void act("remove", `/api/jobs/${job.id}`, { action: "remove" }, `"${job.name}" was removed`);
        }}
      >
        {pending === "remove" ? "Removing..." : "Remove"}
      </Button>
    </div>
  );
}
