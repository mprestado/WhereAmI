# Goal and task list refinement

## Product model

The workspace has one user-facing structure: **Goal or task list → objective → sub-objective**. A new goal offers two layouts:

- **Journey** shows required objectives from Past through the current objective to Future. Use it when the work has a meaningful order.
- **Task list** shows objectives in a simple, reorderable list for work that can happen in any order.

Objectives and sub-objectives may be optional. Required work alone drives Journey progress. The existing quiet canvas and inline journey remain the main workspace. Task views, search, account controls, export and settings stay behind the corner menu.

## Compatibility approach

Keep the shared React/Vite frontend, Tauri shell, Supabase authentication and sync, IndexedDB queue, and existing normalized records. In the stored model, a goal remains a `roadmaps` record with an additive `presentation` field. Existing phases continue to group saved objectives in the database, but new goals use one hidden grouping phase and the interface treats objectives as one ordered sequence. New sub-objectives use existing task records associated with their parent objective; legacy objective checklist records remain readable. Optional flags and ordering fields are additive, and the second migration preserves them when earlier clients omit them.

No records are renamed or discarded as part of this UI change. Old phase placement and milestone data remain available through the retained data model. New user-facing copy uses Goal, Objective, Sub-objective, Journey, Task list, and Checkpoint.

## Progress rules

- A required sub-objective counts once. A completed required sub-objective contributes one completed item.
- Optional sub-objectives and optional objectives do not block completion or contribute to required progress.
- A required objective with required sub-objectives is complete when all those sub-objectives are complete. If it has no required sub-objectives, it can be completed manually and counts as one item.
- Goal progress is the sum of required sub-objective work and manually completed empty objectives. It is zero when there is no required work; optional-only goals remain at zero.
- The current Journey objective is the first incomplete required objective in objective order. Completing or reopening work recalculates the current position from saved state.
- Task checklists remain part of the task editor and do not add another copy of the task to goal progress.

## Interaction sequence

1. A new workspace shows a centered create button. The user enters a title and chooses Journey or Task list.
2. The user adds, reorders, marks optional, or removes objectives and nested sub-objectives in an expanding editor. Existing objectives can be moved between parents.
3. Journey mode places completed objectives on the left, the first incomplete required objective in the center, and upcoming objectives on the right. Task list mode shows a plain ordered list.
4. Inline checkboxes, title edits, contextual actions and accessible up/down controls keep routine work in place. Deletion uses a small confirmation.
5. A compact corner menu opens goal switching, task views, search, account, settings and export without a permanent sidebar.

## Verification

Run TypeScript checks, domain and PostgreSQL migration tests, browser workflows at desktop and mobile sizes, the two-client sync integration, and the Windows build where the host toolchain permits. A configured Supabase project is still required to verify hosted authentication, Realtime delivery, and live Windows-to-phone synchronization.
