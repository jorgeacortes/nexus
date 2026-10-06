# Assessment — what the Nexus board should *show* on a phone

Task `499036b1` (nexus). Question: *the board is usable on a phone now — does it
communicate as well as it does on the desktop, and what should the phone view
optimize for?*

2026-10-05. Baseline is `18b38c6` (`1846255b`, "make the app usable on a phone"):
nav bar + drawer, board snap-scroll, servers card list, dialogs capped at
`100svh`, sheet full-width below `sm`, 40px hit areas on coarse pointers. That
work settled *reachability*; this doc is about the information the phone renders
once you are there, and it does not propose redoing any of it.

**How the numbers below were obtained.** Chromium (Playwright 1.58.2, bundled
build) with `isMobile: true`, `hasTouch: true`, `deviceScaleFactor: 2`, at
375×667 and 390×844 in dark and light, against the running deployed board
`http://localhost:3210` (`/api/instance`: `nexus.db`, 6 projects / 111 tasks).
Touch gestures were driven through CDP `Input.dispatchTouchEvent`; every non-GET
`/api/*` request was aborted during the touch tests. Numbers marked "measured"
are read off that render; the few derived ones say so.

## 0. The finding, up front

**The phone currently renders the desktop board faithfully and communicates much
less.** Measured at 375×667: 180px of the 667px viewport is chrome before a card
appears (27%), one 290px column is on screen with 57px of the next peeking, and a
column's scroll area is 352px tall — **two cards fully visible**. The Done column
holds 83 of the 111 tasks and needs **45.7 screens of vertical scrolling**
(16,086px in a 352px window). Drag-to-move does not exist on touch (measured: 0
`dragstart` events from a long-press drag), and the tap-path that replaces it
opens a sheet whose Description field renders 2,610px tall, putting the Status
select **2,915px down a 515px viewport**.

That is not a styling problem, it is a mismatch of job. Design the phone view for
the job the phone can actually do — **the operator's decision queue plus a
one-glance fleet check** — and most of the board's per-card furniture stops
earning its space.

| | Desktop board (1440×900) | Phone board (375×667) |
| --- | --- | --- |
| Columns on screen | 3 of 5 (fixed 290px each) | 1 of 5 (+57px peek) |
| Cards fully visible | 5 / 4 / 3 / 0 / 3 (per column) | 2 per column |
| Axis the card list scrolls | vertical, inside a column | vertical inside, horizontal between |
| Chrome above the cards | — | 180px (27% of the viewport) |
| Move a card | drag | tap → sheet → scroll 2,915px → select |
| Board-level shape ("backlog 16, ready 9, in progress 3, blocked 0, done 83") | all five headers at once | 4 swipes |

> **Correction, added at implementation time.** The implementing agent could not
> reproduce the 180px chrome figure on the same rig: on the pre-change deployed
> board it measures **241px** of chrome and the first card at **298px**. Treat the
> 180 as specific to the investigating rig. The metrics that decide the design were
> re-measured against 241 and the improvement holds — the sheet's Status field went
> from 2,915px to **269px**, and compact cards fit 3-4 where 2 did, even though the
> new status strip adds 70px of chrome (241 → 335).

The *data* on the board is not the problem: 111 tasks, 6 projects, 5 flagged
`needsHuman`, 9 live agents across 3 Herdr workspaces. The problem is that 375px
is being asked to render a workspace.

## 1. What a phone is for, in this app

Three candidate jobs, and what the app can actually support for each:

1. **Curate** — create, edit, re-tag, re-prioritise, re-assign, move cards.
2. **Glance** — what is running, what needs me, what changed.
3. **Act** — answer a decision the app is explicitly waiting on: resolve/unblock a
   `needsHuman` task, mark a `done` task reviewed, flag a blocked agent.

**Chosen job: 2 + 3 — the decision queue, with a one-glance fleet check. Explicitly
not 1.**

The evidence for this, in order of weight:

- **The measured cost of curating on a phone is prohibitive, and it is not
  fixable by density.** Reaching one specific task among the 83 done cards is 45.7
  screens of column scrolling; the project filter strip is 199.8px of visible
  window over 803px of chips; the edit sheet is 3,177px of form in a 515px
  viewport. A phone is a fine place to *decide* about a card; it is a bad place to
  browse a 111-row ledger. That is a measurement, not a preference.
- **The data says the operator's attention is worth ~5 rows, not 111.** 5 tasks
  carry `needsHuman` (the ball in the operator's court); 3 are `in_progress`; 0 are
  blocked; 83 are done. The actionable set is one thumb-scroll long.
- **The app's write paths that need no keyboard are exactly the decision paths.**
  The inbox row's `Resolve`/`Unblock` dialog, the sheet's `Reviewed` toggle and
  `needsHuman` flag, and (in the sheet) a status `NativeSelect`. Everything else —
  title, description, project, assignment — is prose and dropdowns, which is
  keyboard work.
- **There is no push channel and there will not be one.** No daemon, no poller,
  no auth, no web push; the board is plain HTTP. So the phone job cannot be
  "notify me the moment something changes" — it is "when I look, tell me what is
  waiting". That makes the *ordering and labelling* of the queue the whole feature.
- **The prior mobile commit already voted this way.** Its board work was the
  snap-scroll and the chip strip (make the desktop board reachable), while its
  most opinionated change was the amber "5 need you" pill in the mobile header —
  present on every screen, 93.7×40 measured, one tap to `/inbox`.

**One honest gap:** there is no usage telemetry in this app, and I did not
instrument the operator's phone. I cannot prove the phone is used this way; the
job above is argued from what the phone can do, what the data says is urgent, and
the affordances the app already has. Whether the operator reaches for the phone to
*decide* or to *inspect* is the first open question (§9.1).

## 2. What the app renders today at 375px (measured)

Geometry, 375×667 and 390×844:

| Measure | 375×667 | 390×844 |
| --- | --- | --- |
| Page horizontal overflow | 0px (`scrollWidth` 375 = `innerWidth` 375) | 0px |
| Page vertical scroll | none (`scrollHeight` 667 = `innerHeight`) — each screen owns its own scroller | none |
| Mobile nav / page header / filter bar | 53 / 66 / 61 = **180px** (27%) | 180px (21%) |
| Board region | 426px | 603px |
| Column width, next column peek | 290px, 57px | 290px, 72px |
| Column inner scroll area | 352px | 529px |
| Cards fully visible, unscrolled | **2** | **3** |
| Board horizontal scroll | `scrollWidth` 1530, `clientWidth` 375, max `scrollLeft` 1155 | same |

Column contents (all 111 tasks; 6 projects): Backlog 16, Ready 9, In progress 3,
Blocked 0, Done 83.

Card heights, measured per column:

| Column | n | min | median | max |
| --- | --- | --- | --- | --- |
| Backlog | 16 | 77.3 | 141.5 | 218.5 |
| Ready | 9 | 141.5 | 160.8 | 186.8 |
| In progress | 3 | 164.0 | 187.9 | 202.5 |
| Done | 83 | 99.8 | 187.9 | 303.4 |

Anatomy of a representative card (first Backlog card, 272×141.5):

| Part | Rendered | Share of the card |
| --- | --- | --- |
| Title, 2 lines | 38.5px (51 chars) | 27% |
| Description excerpt, 2 lines | 39.0px — **84 of 1,387 characters visible** | 28% |
| Model/effort row | 18px (57 of 111 cards have one) | 13% |
| Badge row | 20px (priority + project + assignee + status + claimed) | 14% |
| Padding + gaps | the rest | 18% |

Card contents as rendered today: 109 of 111 cards show a description excerpt
(median description 1,312 characters — the excerpt shows ~6%); priority badges are
45 High, **62 Normal**, 2 Low, 2 Someday, i.e. the priority chip is on every card
and says "Normal" on 56% of them.

Things that do not work on the phone today, measured:

- **Drag-to-move: absent.** Long-press + drag on a card fired `touchstart` but
  **0 `dragstart`, 0 `dragend`, 0 `drop`**, and 0 API writes. `package.json` has
  `react-dnd-html5-backend` and nothing else — HTML5 DnD is a mouse/pen gesture.
  The replacement path is the sheet: measured at 375×667 the sheet's scroll area
  is 515px with `scrollHeight` 3,177px, the Description textarea alone renders
  **2,610px** tall (`field-sizing-content`), and `#detail-status` sits at
  **y = 2,915px** — about 5.7 viewports of scrolling to change a status. On a
  `done` task the two actions the phone exists for are at the very bottom:
  `Mark reviewed` at **y = 2,998px** and `Flag as needing human` at **y = 3,123px**
  in a 515px window (measured, 5.8 and 6.1 screens).
- **Touch tap opens the card.** A tap on a visible card opens the detail sheet
  (1 dialog) — the interaction itself is fine; it is the depth of the form behind it.
- **Both axes work but the page never moves.** A 260px horizontal swipe moved the
  board one column (`scrollLeft` 0 → 302); a vertical swipe inside a column
  scrolled that column (0 → 245) with `window.scrollY` unchanged. Gestures are
  sound — there are just two axes to reason about 375px wide.
- **The 40px rule has two holes.** Auditing every visible control at 375×667:
  on `/board` exactly 2 controls are under 40px — `Open navigation` **32×32** and
  `New task` **99×28**; on `/servers` one — "6 host services hidden" **343×32**.
  The cause is mechanical: `@media (pointer: coarse) { [data-slot="button"] {
  min-height: 2.5rem } }` (`src/app/globals.css:139-149`) misses Buttons rendered
  through Radix `asChild` triggers, because the Slot overwrites the Button's
  `data-slot="button"` with `data-slot="sheet-trigger"` / `"dialog-trigger"`
  (measured on the live DOM). Everything else — filter chips, cards, inbox
  actions, the 40×40 copy button — is at 40px.
- **The filter bar is the wrong shape for 375px.** The project chip strip is a
  199.8px window over 803px of chips (25% visible) and the pinned `Needs review`
  chip is 135.2px, 36% of the viewport width, holding a count of **81** (done tasks
  not reviewed).

`/inbox` at 375×667: 5 needs-you rows in a 503px scroll area (1,430px total, 2.8
screens), rows 202–242px tall, the action button at the bottom of each row;
**no age or relative time anywhere on the page** (regex for `ago|today|yesterday|Nd|Nh`
over `body.innerText` → false). Ordering comes from the repository's `findAll()`
= `updatedAt` desc, so the queue is ordered by *last activity*, not by *how long
the ball has been with the operator*.

`/agents` at 375×667 lists every live agent grouped by Herdr workspace (measured:
9 agents in 3 workspaces — `manager` 4, `nexus` 4, `investigation` 1), including
panes that carry no task at all ("No task linked to this pane", 2 of them at the
time of measurement) and each pane's own tab label, with pane id, status and
model. It is a faithful render of a desktop table and a long list for a glance.

## 3. Which information earns 375px

The rule to apply is not "make it smaller" — it is *decide, or don't show*. A
field earns its place on a phone card only if it changes what the operator does
next. Applying that to the card as rendered:

| Field | Today | On 375px | Why |
| --- | --- | --- | --- |
| Title | 2–3 lines, 27% of the card | **keep, 2 lines** (3 allowed for `needsHuman`) | the only unambiguous identity of the card, and what a `needsHumanReason` refers to |
| `needsHuman` badge | top-right (already first) | **keep, first thing after the title** | the actionable signal; the card and the row must lead with it |
| Harness chip + live status dot | badge row | **keep** | answers the fleet question ("who is on this, still moving?") without a tap |
| Project tag | badge row | **keep, truncated to ~12 chars** | the project is a tag, never a column (`PLAN.md` decisions 2–3); it is the only in-view hint of which project a card belongs to |
| Priority | chip on 111/111 cards, "Normal" on 62 | **keep only `blocker` / `high` / `low` / `someday`** | "Normal" is the default and carries no signal; measured, it is the most common chip in the app |
| Description excerpt | 2 lines, 28% of the card, ~6% of the text | **drop on the board card** (keep 1 line in the inbox row, where the row is about one decision) | measured: 84 of 1,387 characters — a fragment too short to decide on, in the space two more cards would fit |
| Model/effort row | own row, 13% of the card | **behind a tap** — the sheet's assignment fields, and the inbox row, where the agent is the subject | see below |
| `Reviewed` badge | done cards | **drop** (the sheet's toggle already owns it) | it is a personal bookkeeping fact, not a decision |
| `claimed <relative>` | badge row, wraps it to 2 rows | **drop**, or replace with a single age on `needsHuman` cards | "what changed" is better served by the queue's ordering (§5) than by a wrapping third row |
| Full description, task id, pane id, `completionNotes` | sheet | **stay behind the tap** | correct as-is |

**The mobile equivalent of "the model never lives inside a chip."** On desktop the
rule exists for a measured reason: an id inside `max-w-[170px]` was truncated into
unreadability, so `ModelTag` got its own wrapping row. On a 272px card the same
requirement has the same shape but a different answer, because a row now costs 13%
of the card: **the model must never be truncated and must never be folded into the
`AssigneeChip`; if it is rendered it gets a full-width row, and on the board card
it is not rendered at all — the row appears where the model is the subject (the
inbox row, the sheet, `/agents`).** So the invariant survives as *a model is never
a chip and never clipped*, and the phone's answer to "where does it go" is *behind
a tap*, not *on a smaller chip*. If the operator wants the model on the card, the
correct form remains a full second line, not a badge.

Estimated effect of the above (arithmetic over the measured parts, not a render):
title 38.5 + one badge row 20 + padding ≈ **82–90px**, against a measured 141.5
median — i.e. 3–4 cards per 352px column window instead of 2, and 4–6 instead of 3
at 390×844. The estimate is stated as such; it is one measured card away from
being verified (§7).

## 4. Is snap-scroll columns the right model on a phone?

Options, with what each keeps and what each costs. Costs are the measured ones
from §0–§2.

| # | Option | Keeps | Loses | Cost |
| --- | --- | --- | --- | --- |
| 1 | **Snap columns (today)** | the board's mental model exactly; a stable one-gesture column change; column header stays pinned so "where am I" is never lost | the board's *shape*: only one column visible, so `16 / 9 / 3 / 0 / 83` is 4 swipes away; two scroll axes; only 2 cards per screen; the drag affordance the columns imply does not exist on touch | 0 (already built) |
| 2 | **Grouped vertical list** (sections in board order, counts on the headers) | all five counts in one gesture; one scroll axis; every status reachable without a tab-like control | the kanban glance (an empty column as *empty space* becomes a number); drop targets; sections for `Blocked` (0) and `In progress` (3) still take vertical space | one new render path for the same `byStatus` map; ~1 component |
| 3 | **Status strip + single-column list** (five count-carrying chips, the selected status's cards below) | the counts at all times (the shape the snap view cannot show); one axis; reuses the existing chip-strip pattern the project filter already proves works on touch | one tap (not a swipe) to change status; the "peek" affordance that hints the board continues | as above, plus a small client state for the selected status |
| 4 | **"Needs me" home** (inbox first, board behind a tap) | the phone's actual job; shortest path to a decision | the board on phones becomes a two-tap destination; duplicates the inbox's job; risks reading as a second product | near zero code, but it changes what the phone *is* — an operator decision, not a layout one |

Reading them honestly:

- **Option 1 is not wrong, it is under-informative.** The measured problem is not
  the columns, it is that a 375px window can show one of them, so the *board-level*
  information (which status is piling up) is exactly the information the phone
  loses. Note the desktop has the same property at 1440px — only 3 of 5 columns fit
  — so this is not a mobile-only defect; the phone just has no room to compensate.
- **Option 2's cost is real but small** and its gain is the whole board's shape in
  one gesture. Its weakness is that `Blocked` is empty and `In progress` has 3
  cards, so three of five sections are mostly whitespace on a 667px screen.
- **Option 3 is Option 2 with the sections paid for lazily** — the counts are
  always visible (so nothing is hidden), but only one section's cards are rendered.
  It also matches an affordance the app already ships and the operator already uses
  on a phone (the project chip strip), and it does not touch the desktop board at
  all.
- **Option 4 is a product decision about what the phone is**, and the honest
  version of it already exists: the amber `5 need you` pill in the mobile header is
  on every screen. It should not replace the board — the constraint is one board,
  and a phone-only home screen is the thin end of a second product — but it does
  argue for making `/inbox` the phone's *default* destination, which is a one-line
  routing decision the operator can take later (§9.3).

**Recommendation: option 3** (§6).

## 5. The agents view and the inbox

The two screens answer the phone's questions differently, and today the ordering is
the wrong way round for a decision queue.

- **Inbox.** It is the only screen whose rows carry the action inline
  (`Resolve`/`Unblock`, 90–91×40 measured), and it is where `needsHumanReason`
  surfaces as the row's text. What it does not do is *rank*: it is fed by
  `findAll()` (`updatedAt` desc) and renders no age at all (measured: no
  time-like string anywhere on the page). So the row the operator most needs —
  the one whose ball has been in their court longest — can sit below one touched
  an hour ago. The fix is a sort key and one label, not a screen: order
  `needsHuman` rows by how long they have been flagged (or by age of
  `updatedAt` when that is the honest proxy) and print it.
- **Suggested — agent blocked.** The inbox already has the section that joins the
  two screens: a task whose linked agent reports `blocked` is surfaced there
  instead of only on `/agents`. Today it is empty (measured: "No linked agent
  reports blocked"), so it costs a heading; keep it, because it is the bridge that
  makes `/agents` unnecessary for a decision.
- **Agents.** With one agent per task, `needsHuman` carrying the ball, and 9 live
  agents across 3 workspaces, the phone should surface this as a summary — counts
  by status (measured at `/api/herdr/snapshot`: 2 working, 3 idle, 4 done, 0
  blocked) plus the tasks those agents hold —
  and *not* as the current list of every pane, which includes panes with no task
  at all ("No task linked to this pane") and each pane's internal tab label. A pane
  with no task is unactionable on a phone; it belongs collapsed or behind a tap.
- **What the phone surfaces first: the inbox.** The "N need you" pill is already
  the persistent affordance; the improvement is to make the inbox's top row the
  oldest decision rather than the most recently touched one. `/agents` should be
  the fleet *summary* (is anything still working?) and the place to see the model
  and pane — detail, not the entry point.

## 6. Recommendation

**Keep the board as it is on desktop and stop rendering a workspace at 375px.
On phones, the board becomes count-first and single-axis — a sticky status strip
carrying all five counts (Backlog 16, Ready 9, In progress 3, Blocked 0, Done 83)
with the selected status's cards as a compact one-column list — and the compact
card keeps the title, the `needsHuman` badge, the harness chip with its live status
dot, the project tag and only non-`normal` priorities; the description excerpt,
the `Reviewed` badge, the `claimed …` time and the model/effort row move behind a
tap. The phone's home is the inbox, ordered by how long a task has waited, and the
mobile header's "N need you" pill stays its entry point.**

Two consequences worth stating plainly:

- This is a **render branch, not a second app**: same route, same `byStatus`
  grouping, same `TaskCard` with a compact variant, same data, no new endpoint, no
  new dependency, and the desktop board untouched. It does mean two board layouts
  to keep honest — that is the price (§8).
- It **does not add drag-to-move**, and it does not need to: the phone's move is
  tap → sheet. But then the sheet's Depth is the bug (§2: Status at 2,915px,
  `Mark reviewed` at 2,998px, `Flag as needing human` at 3,123px in a 515px
  window). One small, separate fix — do not let the Description textarea auto-size
  inside the sheet on a phone, and put project/status/priority and the two
  decision toggles above it — turns the phone's whole act path from ~6 screens into
  under one. That is the single highest-value line of code in this whole area, and
  it is smaller than the board work.

Explicitly rejected: adding `react-dnd-touch-backend` (a new dependency to make a
*mouse* gesture work on touch, when moving a card is a deliberate act and the sheet
already owns the edit path), a `/m` route or a separate mobile board (constraint:
one board), and any per-project phone board (constraints 2–3).

## 7. How we would know it worked

Same rig as the previous task, so the numbers are comparable: Chromium with
`isMobile: true` + `hasTouch: true`, 375×667 and 390×844, dark and light, against
the deployed board, plus a read-only audit pass. The assertion is *numbers*, and
each one has a baseline measured in this doc. "Looks nicer" is not on the list.

| # | Metric | Baseline (measured) | Target |
| --- | --- | --- | --- |
| 1 | Cards fully visible in a column window | 2 @ 375×667, 3 @ 390×844 | ≥3 / ≥4 |
| 2 | Board-level shape: statuses visible without a gesture | 1 of 5 | 5 of 5 (counts) |
| 3 | Screens of scrolling to a task in Done | 45.7 | not worse; and a task reachable from the inbox or by filter in ≤1 |
| 4 | Taps + scroll to reach and act on the oldest `needsHuman` task | 1 tap + up to ~2.8 screens + 1 tap | 1 tap + 0 scroll + 1 tap (it is the first row) |
| 5 | Sheet scroll to the Status control, and to `Mark reviewed` / `Flag as needing human` | 2,915px / 2,998px / 3,123px in a 515px viewport (5.7–6.1 screens) | ≤1 screen for Status and both toggles |
| 6 | Page horizontal overflow | 0px | must stay 0px |
| 7 | Visible controls under 40px | 2 on `/board` (`Open navigation` 32×32, `New task` 99×28), 1 on `/servers` | 0 (fix the `data-slot` hole, `src/app/globals.css:139-149`) |
| 8 | Position of the oldest `needsHuman` row in the inbox | not first: the queue is ordered by `updatedAt` desc; 2 of 5 rows visible in a 503px window (1,430px content) | it is the first row, with an age label (row count is not the goal) |

**A real phone is required for exactly one question, and it is cheap.** Device
emulation proves geometry; it cannot prove gesture feel, and it cannot settle
whether a long-press drag starts an HTML5 drag on a real touch browser (I measured
0 `dragstart` in emulated Chromium, and no touch backend is installed — so the
claim is strongly supported, not proven for every phone). The board already
publishes on `${BIND_ADDRESS:-0.0.0.0}:${HOST_PORT:-3210}`
(`docker-compose.yml:46-47`), so opening it on a phone over the LAN needs no new
work and no deployment: do that once, for the drag question and for feel, and keep
the emulated rig for the eight metrics above. (If that default is ever narrowed to
loopback — the subject of a separate open task — the phone check goes through the
tailnet instead.)

## 8. Cost and risk

- **Cost.** Roughly: a compact `TaskCard` variant, one phone-only board layout in
  `board-client.tsx` (the `byStatus` map already exists), a status strip (the
  `BoardFilterBar` chip pattern already exists), and the sheet ordering/textarea
  fix. No new dependency, no migration, no endpoint, no route, no Docker change.
  `pnpm validate` stays the gate; the board has no unit tests to update (the
  filter logic in `board-filter.ts` is the only tested piece and is untouched).
- **Risk 1 — two layouts drift.** The desktop board and the phone list are
  separate render paths by construction (a grouped/selected list cannot be
  expressed as a CSS variant of five fixed columns). Mitigation: one `TaskCard`
  with a `compact` prop, one shared `byStatus`, and the §7 metric list as the
  review checklist. This is the main cost of the recommendation and should be
  stated as such when it is approved.
- **Risk 2 — the phone silently becomes a second product.** A phone-only board
  layout is defensible; a phone-only *board* (filters that exist only on phones,
  a needs-me home that replaces the board) is not, and would erode `PLAN.md`
  decisions 2–3 by the back door. Keep the same route, the same filter semantics,
  and the same URL parameters on both layouts.
- **Risk 3 — the model rule gets re-broken.** Dropping `ModelTag` from the card
  must not become "put the model back in `AssigneeChip`". The rule is
  "never a chip, never clipped, and on a board card not at all" (§3) and it
  deserves one sentence in `AGENTS.md` next to the existing desktop rule when the
  change lands — not now, and not by this doc.
- **Not a risk:** one operator, one board, 111 tasks, no concurrency, no auth. The
  work is layout, and it can be reverted by reverting one component.
- **Disproportionate ideas, named so they are not re-proposed:** a
  swipeable card deck, gestures on cards (swipe-to-move), a phone-only detail page,
  offline/PWA support (`PLAN.md`: no mobile apps), and pagination for the Done
  column (a phone-side "last N / filtered" view is enough at this size — but if
  Done is to be browsable on a phone at all, a *filter* is the honest fix, not a
  denser card).

## 9. Open questions for the operator

1. **Is the phone for deciding or for inspecting?** I designed for deciding
   (§1) on the strength of the data and the write paths, and I could not measure
   the operator's actual use — there is no telemetry. If the honest answer is "I
   open it to check whether the fleet is still moving", the recommendation
   collapses to the inbox ordering plus the `/agents` summary and the board can
   stay exactly as it is.
2. **Should the Done column be browsable on a phone at all?** 83 of 111 tasks are
   done and cost 45.7 screens. Options: leave it (scroll), default the phone to a
   non-done status, or add a "recent/needs review" phone view of Done. The 81
   unreviewed done tasks suggest the phone's interest in Done is the *review*
   queue, not the archive.
3. **Does the phone default to `/inbox`?** One routing decision, and the pill in
   the header already argues for it. It is the one change here that alters what the
   phone *is*, so it is the operator's call, not a layout detail.
4. **Should the inbox order by how long the ball has waited** (rather than by
   `updatedAt`)? This needs no new column — `needsHuman` tasks can sort by age of
   `updatedAt`, and a "flagged Nd ago" label is derivable — but if the operator
   wants true queue age, `needsHumanSince` would be a schema addition and is a
   separate decision.
5. **Model on the compact card: never, or as a full second line?** My
   recommendation is never on the board and always in the inbox row; the operator
   may disagree about the board, in which case the answer is a whole line, not a
   chip.
6. **Is `/agents` allowed to hide task-less panes on phones?** It currently lists
   every pane, including ones with no task. Hiding them on a phone is a small win
   and a small divergence from desktop.

## 10. Evidence

**Rendered and measured** (Playwright 1.58.2 bundled Chromium; `isMobile: true`,
`hasTouch: true`, `deviceScaleFactor: 2`; 375×667 and 390×844; dark and light;
`http://localhost:3210` = the deployed board, `/api/instance` → `nexus.db`, 6
projects / 111 tasks; touch via CDP `Input.dispatchTouchEvent`; all non-GET
`/api/*` aborted during touch tests). The render's screenshots were transient and are not retained; the operator
verifies the UI visually themselves. Everything in §0, §2 and the metric baselines in §7 is from this
render, except where a figure is explicitly labelled as arithmetic or as a source
fact.

**Source facts cited above**

- `src/app/(main)/board/_components/board-client.tsx` — the snap-scroll container
  (`snap-x snap-proximity … md:snap-none`), `byStatus` grouping, sort by priority
  then `updatedAt`; `board-column.tsx` — `w-[calc(100vw-3rem)] max-w-[290px]
  shrink-0 snap-start`, inner `overflow-y-auto`; `task-card.tsx` — the card's full
  field list (title, `line-clamp-2` description, `ModelTag`, priority chip, project
  badge, `Reviewed` badge, `AssigneeChip`, status dot, `claimed …`).
- `src/components/model-tag.tsx`, `assignee-chip.tsx`,
  `src/app/(main)/board/_components/needs-human-badge.tsx` — the desktop model rule
  ("a label, not a chip").
- `src/app/(main)/board/_components/board-filter-bar.tsx` — project chip strip
  (`overflow-x-auto` below `md`) plus the pinned `Needs review` chip.
- `src/app/(main)/board/_components/task-detail-sheet.tsx` + `src/components/ui/textarea.tsx:10`
  — the sheet's field order (id → title → description → project/status/priority)
  and `field-sizing-content`, which makes the Description grow to its content.
- `src/components/theme-boot.tsx`, `src/lib/theme.ts` — theme key `nexus-theme`,
  dark by default.
- `src/app/(main)/_components/mobile-nav.tsx`, `nav-items.ts`,
  `sidebar-nav.tsx` — the phone bar, the `N need you` pill, the shared drawer.
- `src/app/(main)/inbox/_components/inbox-client.tsx`, `inbox/page.tsx` — the
  three sections (`Needs you`, `Suggested — agent blocked`, `No project — triage`),
  inline `Resolve`/`Unblock`, `needsHumanReason` as the row text, and no time
  anywhere; ordering from `taskRepo.findAll()`.
- `src/infrastructure/repositories/tasks/drizzle-task.repository.ts:102` —
  `findAll()` = `orderBy(desc(tasks.updatedAt))`.
- `src/app/globals.css:139-149` — the `@media (pointer: coarse)` 40px rule and its
  `[data-slot="button"]` selector; `src/components/ui/button.tsx:56` —
  `data-slot="button"` (overwritten when the Button is a Radix trigger child).
- `package.json` — `react-dnd@^16`, `react-dnd-html5-backend@^16`, and no touch
  backend.
- `docker-compose.yml:46-47` — `${BIND_ADDRESS:-0.0.0.0}:${HOST_PORT:-3210}:3100`
  (why a real-phone check needs no new work).
- `PLAN.md` decisions 2, 3, 10 (one board; project is a tag; `needs_human` is
  orthogonal to status), and the non-goals (no mobile app, no scalability
  scaffolding); `AGENTS.md` "Which model is the agent running?" and the
  `reviewedAt` rules; `DESIGN-dispatch.md` (the three bounded contexts); commit
  `18b38c6` (the baseline mobile work and what it claims).

**What I could not verify**

- **No real device.** Every number is emulated Chromium. Gesture feel, iOS
  Safari's HTML5-drag behaviour, and the soft keyboard's effect on the `100svh`
  dialogs are unmeasured. The drag claim rests on 0 `dragstart` events under
  emulation plus the absence of a touch backend — strong, not device-proven.
- **No usage data.** Which screen the operator opens on a phone, how often, and
  whether the phone is ever used to *change* a task rather than to look, is unknown.
- **Contrast/legibility was not measured numerically.** Both themes were rendered
  and are structurally identical; I did not compute WCAG ratios for the muted
  text (`text-muted-foreground/70` at 11px) that carries "pane offline" and the
  model line.
- **Card-height after the §3 cuts is arithmetic**, not a render (three measured
  components summed), as stated in §3. It is one render away from being a fact and
  should be re-measured before it is quoted as one.
