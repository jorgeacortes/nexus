"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import type { ProjectDto } from "@/lib/dto";
import { cn } from "@/lib/utils";

import { type BoardSort, NO_PROJECT_KEY, type ProjectFilter, type ReviewFilter } from "./board-filter";

const NO_PROJECT_LABEL = "No project";

/**
 * Filters for the one board: project chips with their task counts, plus a
 * "needs review" chip for done tasks the operator has not verified. Both the
 * selection and the review queue live in the URL — the caller owns reading and
 * writing them — and a chip always shows how much it is hiding.
 *
 * Below `md` the projects take a full-width row of their own. Sharing that
 * row with the sort toggle and Needs review (both `shrink-0`) squeezed the
 * chip strip to a few pixels, so the selected project disappeared and the
 * rest could only be reached by scrolling a hidden, thumb-width track.
 */
export function BoardFilterBar({
  projects,
  counts,
  total,
  visible,
  project,
  review,
  sort,
  needsReview,
  onProjectChange,
  onReviewChange,
  onSortChange,
}: {
  projects: ProjectDto[];
  counts: Map<string, number>;
  total: number;
  visible: number;
  project: ProjectFilter;
  review: ReviewFilter;
  sort: BoardSort;
  needsReview: number;
  onProjectChange: (filter: ProjectFilter) => void;
  onReviewChange: (filter: ReviewFilter) => void;
  onSortChange: (sort: BoardSort) => void;
}) {
  const noProjectCount = counts.get(NO_PROJECT_KEY) ?? 0;
  const filtered = project !== null || review !== null;
  const projectStrip = useRef<HTMLDivElement>(null);

  // A shared `?project=` link should open with that chip in view. The strip
  // starts scrolled to the left, which hides every project past the first.
  const selectedProject = project ?? "all";
  useEffect(() => {
    const strip = projectStrip.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>(`[data-project-filter="${CSS.escape(selectedProject)}"]`);
    if (!active) return;
    const stripBox = strip.getBoundingClientRect();
    const chipBox = active.getBoundingClientRect();
    const pad = 4;
    if (chipBox.left < stripBox.left + pad) {
      strip.scrollLeft -= stripBox.left + pad - chipBox.left;
    } else if (chipBox.right > stripBox.right - pad) {
      strip.scrollLeft += chipBox.right - (stripBox.right - pad);
    }
  }, [selectedProject]);

  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-border px-4 py-2 md:flex-row md:items-center md:px-6 md:py-2.5">
      <span className="hidden shrink-0 text-xs font-medium text-muted-foreground md:inline">Project</span>
      {/* Full-width swipe row on a phone; a wrapping row beside the label on desktop. */}
      <div
        ref={projectStrip}
        className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto overscroll-x-contain py-0.5 [scrollbar-width:thin] md:flex-1 md:flex-wrap md:gap-2 md:overflow-visible md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden"
      >
        <FilterChip
          filterKey="all"
          label="All projects"
          count={total}
          active={project === null}
          onClick={() => onProjectChange(null)}
        />
        {projects.map((project_) => (
          <FilterChip
            key={project_.id}
            filterKey={project_.id}
            label={project_.name}
            count={counts.get(project_.id) ?? 0}
            active={project === project_.id}
            onClick={() => onProjectChange(project === project_.id ? null : project_.id)}
          />
        ))}
        {noProjectCount > 0 ? (
          <FilterChip
            filterKey={NO_PROJECT_KEY}
            label={NO_PROJECT_LABEL}
            count={noProjectCount}
            active={project === NO_PROJECT_KEY}
            onClick={() => onProjectChange(project === NO_PROJECT_KEY ? null : NO_PROJECT_KEY)}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap">
        <SortToggle sort={sort} onChange={onSortChange} />
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
              className="text-xs max-md:min-h-10"
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

/**
 * The sort order: "Recent" (last activity, the default) floats a freshly
 * touched card to the top of its column; "Priority" keeps the older planning
 * view. The value lives in the URL (`?sort=`), so a shared link carries it.
 */
function SortToggle({ sort, onChange }: { sort: BoardSort; onChange: (sort: BoardSort) => void }) {
  return (
    <fieldset aria-label="Sort tasks" className="m-0 flex shrink-0 items-center rounded-md border border-border p-0.5">
      {(["activity", "priority"] as const).map((value) => (
        <Button
          key={value}
          type="button"
          variant={sort === value ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-xs max-md:min-h-10"
          aria-pressed={sort === value}
          onClick={() => onChange(value)}
        >
          {value === "activity" ? "Recent" : "Priority"}
        </Button>
      ))}
    </fieldset>
  );
}

/** A toggle chip; clicking the active one again clears the filter. */
function FilterChip({
  filterKey,
  label,
  count,
  active,
  onClick,
}: {
  filterKey?: string;
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
      className="max-md:min-h-10 gap-1.5"
      data-project-filter={filterKey}
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
