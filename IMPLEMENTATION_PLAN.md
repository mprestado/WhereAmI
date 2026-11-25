# WhereAmI implementation plan

## Architecture

The Windows and web clients share one React/TypeScript frontend. Vite builds the web app and Tauri 2 packages the same interface for Windows. Supabase Auth and PostgreSQL provide accounts and synchronized records; IndexedDB stores a confirmed copy and a durable queue per account. Local device-only use remains available when cloud credentials are absent.

The frontend keeps one primary canvas. Goal creation asks for a title and a layout, then offers an expanding editor for objectives and nested sub-objectives. Journey layout presents past, current, and upcoming required objectives. Task list layout presents objectives in a simple ordered list. A small menu exposes task views, search, goal switching, account, settings and export.

## Unified user-facing model

| Concept | Meaning |
| --- | --- |
| Goal or task list | The desired outcome or collection of work. Its layout is either Journey or Task list. |
| Objective | An ordered unit of work under the goal. Optional objectives stay outside required progress. |
| Sub-objective | A directly checkable task under an objective. It can also be optional. |
| Journey | A way to view ordered work as Past → Present → Future. |

The existing database remains the compatibility layer: `roadmaps` stores goals and layout; `phases` continue to group legacy objectives, while new goals use a single hidden group; `objectives` store objective title, parent and ordering; `tasks` store sub-objectives and ordinary standalone tasks; `checklist_items` remain available for existing records and task details. Milestones and existing metadata are retained. The additive migration adds layout, optional and ordering fields without replacing user data.

## Progress rules

- Each required sub-objective contributes one item; completed required sub-objectives contribute one completed item.
- An objective with required sub-objectives completes when all required sub-objectives are complete.
- A required objective with no required sub-objectives can be completed manually and counts as one item.
- Optional objectives and sub-objectives do not count and do not prevent advancement.
- Overall progress is completed required work divided by required work. It is zero when no required work exists.
- The current Journey objective is the first incomplete required objective in saved order. Editing, reordering and reopening re-derive the position.
- Task checklist items do not get counted twice as both checklist work and sub-objectives.

## Data and synchronization

The authenticated account owns all records through row-level security and owner-scoped foreign keys. Workspace batches use optimistic revisions and idempotent receipts. An online edit stays pending until the server confirms it. Realtime notifications, polling, focus and reconnect refresh other clients. On failure, pending edits remain queued and exportable. The updated client uses the versioned write RPC added by the second migration.

## Implementation sequence

1. Keep the existing Tauri, React, Vite, authentication, local cache and synchronization foundation.
2. Replace dashboard navigation with the empty canvas and low-friction goal creation flow.
3. Add Journey/Task list choice, objective and sub-objective editing, optional work and quick reordering.
4. Render Journey positions or the simple task list and connect progress to the existing saved completion state.
5. Keep goal switching, task views, search, account, settings and export in the closed-by-default corner menu.
6. Update migration and data compatibility, then verify desktop and phone-sized browser behavior, persistence, cloud sync and Windows packaging.

## Verification

Run TypeScript checks, domain tests, database migration tests, browser workflows at desktop and mobile widths, the two-client sync integration, and a Windows build when the host toolchain permits. A configured Supabase project is required to verify hosted authentication, Realtime and live Windows-to-phone behavior. No credentials or successful deployment are assumed.
