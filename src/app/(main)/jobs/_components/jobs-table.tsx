import { NeedsHumanBadge } from "@/app/(main)/board/_components/needs-human-badge";
import type { JobDto, ProjectDto } from "@/lib/dto";
import { relativeTime } from "@/lib/time";

import { PageHeader } from "../../_components/page-header";
import { AddJobForm } from "./add-job-form";
import { JobActions } from "./job-actions";

/** Operator surface for stored jobs. A dead row is needs-human and can be run again. */
export function JobsTable({ jobs, projects }: { jobs: JobDto[]; projects: ProjectDto[] }) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const waiting = jobs.filter((job) => job.needsHuman).length;
  const description =
    jobs.length === 0
      ? "Nothing is scheduled. Add a job to start a soak."
      : waiting > 0
        ? `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}, ${waiting} waiting on you.`
        : `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}.`;

  return (
    <>
      <PageHeader title="Jobs" description={description} />
      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <AddJobForm projects={projects} />
        {jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No jobs yet.
          </p>
        ) : (
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <caption className="sr-only">Scheduled jobs</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Next run</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2 font-medium">Last error</th>
                <th className="px-3 py-2 font-medium">Enabled</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-border/70 align-top">
                  <td className="max-w-xs px-3 py-3">
                    <div className="font-medium">{job.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {job.projectId ? (projectNames.get(job.projectId) ?? "—") : "No project"}
                      {job.schedule
                        ? ` · ${job.schedule}`
                        : job.intervalSeconds
                          ? ` · every ${job.intervalSeconds}s`
                          : ""}
                    </div>
                    {job.needsHuman ? (
                      <div className="mt-2">
                        <NeedsHumanBadge reason={job.lastError} />
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{job.kind}</td>
                  <td className="px-3 py-3">{relativeTime(job.nextRunAt) ?? "—"}</td>
                  <td className="px-3 py-3">
                    <div>{job.lastStatus ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{relativeTime(job.lastRunAt) ?? ""}</div>
                  </td>
                  <td className="max-w-sm px-3 py-3 text-muted-foreground">
                    {job.lastError ? <p className="whitespace-pre-wrap break-words">{job.lastError}</p> : "—"}
                  </td>
                  <td className="px-3 py-3">{job.enabled ? "yes" : "no"}</td>
                  <td className="px-3 py-3 text-right">
                    <JobActions job={job} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
