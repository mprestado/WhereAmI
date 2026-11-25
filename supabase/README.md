# Supabase and sync

## Set up a cloud workspace

1. Create a Supabase project. Apply [the workspace migration](migrations/202611230001_workspace.sql), [the goal presentation migration](migrations/202611230002_goal_presentation.sql), and [the count tracker migration](migrations/202611240003_count_trackers.sql) in that order. Use the Supabase SQL Editor or a linked Supabase CLI project. Apply only migrations the project still needs.
   Before using `supabase db push` on this project after a manual SQL Editor update, reconcile the CLI migration history without rerunning the DDL. For each confirmed applied version use `supabase migration repair --status applied <version> --remote`.
2. In **Authentication → URL Configuration**, set the production web URL as the Site URL. Add the production URL and any development confirmation URL to the Redirect URLs list. Use the production web URL for email confirmation initiated from Windows. After confirmation, sign in from the Windows client using the same email and password.
3. In the web build and Windows build environments, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the same Supabase project. The legacy anon key is also accepted through `VITE_SUPABASE_ANON_KEY`. Set `VITE_AUTH_REDIRECT_URL` when email confirmation should use a different allowlisted URL from the Site URL. Service-role keys and database passwords belong on the server.
4. Rebuild each client. Sign in on two clients, capture a task in one, and wait for the saved indicator. The task should appear in the other within the polling interval, sooner when changes are delivered by Realtime or the app regains focus. Sign in with a different account and verify its workspace starts empty.

Keep the confirmation setting enabled for a public sign-up deployment. Configure Supabase's mail delivery before inviting users. Device-only mode uses a separate workspace on each client and assigns its own tasks to that device.

Apply the goal presentation migration before opening a cloud workspace with the updated clients. Existing goals start with the Journey layout, and existing hierarchy and ordering stay intact. Edits made by an older client preserve goal layout, optional flags and the new ordering fields when the write omits them. An updated client keeps its pending edits if its database still needs the migration.

Apply the count tracker migration before releasing clients with count targets. The read-only `get_workspace_schema_version()` function returns 3 when the migration is installed. Counter edits go through the versioned write function so a server without the tracker fields cannot acknowledge them as saved.

## Data protection and recovery

Authenticated direct reads are protected by owner-only RLS. Every mutation passes through the batch RPC, which binds the request to the authenticated owner, checks optimistic revisions and writes a receipt for idempotent retries. Composite foreign keys reject relationships across users. The Realtime publication includes an owner-filtered revision marker so notifications carry no task content. A 30-second online refresh covers delayed or unavailable Realtime notifications.

The local cache stores a confirmed snapshot and a durable queue per account. An edit stays in the queue until the server acknowledges the batch. If the server's revision has changed, the app retains the local edits and shows a conflict. Export includes queued edits. Discarding queued edits reloads the verified server state. Browser data clearing also removes local caches and unsent changes.

## Local verification

Run `npm test -- supabase/workspace.test.ts` for the database integration checks using PostgreSQL in PGlite.

To exercise sync through two independent browser contexts, run `node supabase/sync.integration.mjs` from the project root after installing a Playwright Chromium build. For installed Google Chrome, set `WHEREAMI_BROWSER_CHANNEL=chrome`. The test runs the real client and migrations with a local HTTP adapter and simulated auth. It checks cross-client reads, offline replay including layout, optional flags and ordering, persistence after a failed request and reload, and stale-edit recovery. Verification of hosted auth delivery, Realtime notifications, and the Windows-to-phone workflow requires a configured Supabase project.
