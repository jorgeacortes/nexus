import { listJobs } from "@/application/jobs/manage-job";
import { jobRepo, projectReference, projectRepo } from "@/infrastructure/container";
import { toJobDto, toProjectDto } from "@/lib/dto";

import { JobsTable } from "./_components/jobs-table";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const [jobs, projects] = await Promise.all([
    listJobs({ jobs: jobRepo, projects: projectReference }),
    projectRepo.findAll(),
  ]);
  return <JobsTable jobs={jobs.map(toJobDto)} projects={projects.map(toProjectDto)} />;
}
