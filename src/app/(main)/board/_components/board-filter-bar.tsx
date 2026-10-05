"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ProjectDto } from "@/lib/dto";
import { cn } from "@/lib/utils";

import { NO_PROJECT_KEY, type ProjectFilter, type ReviewFilter } from "./board-filter";

const NO_PROJECT_LABEL = "No project";

/**
 * Filters for the one board: project chips with their task counts, plus a
 * "needs review" chip for done tasks the operator has not verified. Both the
 * selection and the review queue live in the URL — the caller owns reading and
 * writing them — and a chip always shows how much it is hiding.
 */
export function BoardFilterBar({
  projects,
  counts,
  total,
  visible,
  project,
  review,
  needsReview,
  onProjectChange,
  onReviewChange,
}: {
  projects: ProjectDto[];
  counts: Map<string, number>;
  total: number;
  visible: number;
  project: ProjectFilter;
  review: ReviewFilter;
  needsReview: number;
  onProjectChange: (filter: ProjectFilter) => void;
  onReviewChange: (filter: ReviewFilter) => void;
}) {
  const noProjectCount = counts.get(NO_PROJECT_KEY) ?? 0;
  const filtered = project !== null || review !== null;

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:px-6 md:py-2.5">
      <span className="hidden shrink-0 text-xs font-medium text-muted-foreground md:inline">Project</span>
      {/* One scrollable strip on a phone (the board needs the height), a wrapping row on desktop. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5 [scrollbar-width:none] md:flex-wrap md:overflow-x-visible [&::-webkit-scrollbar]:hidden">
        <FilterChip
          label="All projects"
          count={total}
          active={project === null}
          onClick={() => onProjectChange(null)}
        />
        {projects.map((project_) => (
          <FilterChip
            key={project_.id}
            label={project_.name}
            count={counts.get(project_.id) ?? 0}
            active={project === project_.id}
            onClick={() => onProjectChange(project === project_.id ? null : project_.id)}
          />
        ))}
        {noProjectCount > 0 ? (
          <FilterChip
            label={NO_PROJECT_LABEL}
            count={noProjectCount}
            active={project === NO_PROJECT_KEY}
            onClick={() => onProjectChange(project === NO_PROJECT_KEY ? null : NO_PROJECT_KEY)}
          />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <FilterChip
          label="Needs review"
          count={needsReview}
          active={review !== null}
          onClick={() => onReviewChange(review === null ? "needs-review" : null)}
        />
        {filtered ? (
          <>
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {visible} of {total} tasks
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                onProjectChange(null);
                onReviewChange(null);
              }}
            >
              <X />
              Clear
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A toggle chip; clicking the active one again clears the filter. */
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className="gap-1.5"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
      {count > 0 ? (
        <span
          className={cn(
            "rounded-full px-1 text-[10px] tabular-nums",
            active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </Button>
  );
}
