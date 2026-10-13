# Fork code map

Where things live, so a change starts at the right place instead of a search
through `server/index.ts` (23k lines). Names, not line numbers: grep them.

## Bots handing work to bots
- Tool text the models read (SSOT for how to use them): `server/drivers/agents-catalog.ts`
  (`coordinate_bots`, `relay_question`, …). Tool args → HTTP: `server/drivers/agents-call.ts`.
- `POST /api/internal/coordinate-bots` in `server/index.ts`: picks the thread
  (`store.workThread`: one thread per conversation and teammate, upstream),
  fork `steerCorrection` folds a follow-up into the assignment running there
  (`roomHandoffs.runningFrom`), else `roomHandoffs.enqueue` queues it.
- The handoff tree, queue and lifetimes: `server/room-handoffs.ts`
  (`enqueue`, `tick`, `runningFrom`, `addCorrection`).
  Persisted in `<data>/room-handoffs.json`. After a restart `restore` puts
  cut-off work back in line (`interrupted` → `INTERRUPTED_BY_RESTART` note), max `restarts`.
- Plain conversation turns cut off by a restart: `server/turn-recovery.ts`
  (`<data>/running-turns.json`), picked up in `server/index.ts` (`INTERRUPTED_TURN_PROMPT`).
- Running a handoff turn and reporting back: `const roomHandoffs = new RoomHandoffs(` in
  `server/index.ts` (`run`, `report`, `busy`); turn text: `coordinationTurnText`,
  `outstandingAssignmentsPrompt`.
- Steering a running turn: `adapter.steer` (all main drivers), person messages
  via `server/steer-queue.ts`, bot asides via `server/aside-queue.ts`;
  person boundary `steerCrossesPerson`.
- Chief-only relay of questions: `shared/relay-question.ts`, `relay_question` route.

## Conversations per person (who may see/write a thread)
- The rule (SSOT): `server/thread-access.ts` — every conversation is private: it is its starter's
  (`thread-starters.json`; work a bot opened for someone is that person's, via `openerFrom`; a routine
  run is its maker's; else the install owner = admins[0]). Visible to that person, the people they
  shared it with by name (`thread-shares.json`) and admins (role `team`). Always on when the sign-in
  list has members (`privateThreads()` in index.ts, no env; `OMB_TEST_TEAM_THREADS=1` is only for
  upstream e2e fixtures written for team-wide threads). Loopback sees all. `thread-private.json`
  (old Privé flags) is no longer read.
- What may flow from one conversation into another (Recent work brief, auto-recall, session_search,
  session_read, list_threads, close_thread, room recent work): `threadFeeds` via `feedsThread(into)` —
  only threads everyone the target thread is for may open themselves; the admin view does not count.
- Work for a person never lands in someone else's thread: ask_bot/delegate_bot open a fresh thread of
  theirs (`guestWorkThread`), a code card's thread is per person (`store.workThreadOn(…, mine)`),
  a routine reports into its person's thread (`resolveResultsThread`).
- Applied once, in `server/bot-visibility.ts`: `VisibleSet.threadRole` narrows `.thread()`, so the
  request gate, search, attachments and live frames follow; `ownThreads` marks each task with
  `access` (own/shared/team) and `person`, and opens the viewer's latest own thread (GET /api/bots).
- Gate in `handleRequest` (index.ts, "names only threads it may open"): path task id, `?threadId`,
  and every JSON body's `threadId` via `onParsedBody` (`server/harness/http.ts`).
- Share routes: `server/routes/fork-threads.ts` (`PUT {people:[…]}`, only the thread's person);
  UI `src/components/ThreadShare.tsx` (lock/people icon in the chat header), channel picker
  `src/components/ThreadChannel.tsx` (filters `BotThreadList`); composer gating `src/lib/cloud-guest.ts`
  (`privateThreads` from /api/auth/session).
- Tests: `server/thread-access.test.ts`, `server/private-threads.e2e.test.ts`,
  `server/private-threads-delegation.e2e.test.ts`.

## Fork routes and people
- New fork HTTP routes go in `server/routes/fork-people.ts` (route table), not inline in index.ts.
- Thread worktrees: `server/thread-worktrees.ts`. Outgoing Gmail: `server/email-outbox.ts`.
- Mail through a custom MCP server (Outlook/ms365, Odoo, …): `outbound` on the server in
  config.json `mcpServers` (preset `"ms365"`/`"odoo"`, `tools`, `unattendedTo`). Rules and the
  card: `server/mcp-mail.ts`; every such server is mounted behind `server/mcp-mail-gate.ts`
  (`withMailGate` in index.ts → `server/mcp-mail-mount.ts`), which holds a sending call on
  `/api/internal/mcp-mail` until the person sends or discards the email card. All approval
  modes, Full included; a routine with mail "send" passes. Tests: `server/mcp-mail*.test.ts`.

## Environments behind the front door (omb-voordeur, bots.jabeja.be)
- Settings → Account → Omgeving: `src/components/OmgevingSection.tsx`, data + switch in
  `src/lib/voordeur-omgevingen.ts` (`GET /__voordeur/omgevingen`, `POST /__voordeur/wissel`, both
  answered by the voordeur, not this server; without a voordeur the SPA page comes back and the item
  stays hidden). Shown only with 2+ environments; the profile row then shows the current one.
  Electron needs nothing: a saved server is an origin and the switch is a same-origin reload.

## Tests, build, deploy (all on THE BEAST)
- `fork/beast.sh` (sourced, SSOT): host, one workspace per worktree `~/omb-fork/wt/<worktree>`
  (node_modules + tsbuildinfo survive), one detached container run that follows its log.
  `fork/beast-prepare.sh`: installs only when pnpm-lock.yaml/package.json changed.
- `fork/check.sh [--base X]` — the gate for a change: incremental typecheck, oxlint on changed
  files, tests named after changed files; warm ≈6 s (an index.ts change adds index.test.ts ≈100 s).
- `fork/test-beast.sh [--files …] [--workers N]` — full suite (upstream merges, nightly) →
  `fork/test-run.mjs` in a container:
  duration-packed jobs, long files sliced by test name, failed tests rerun alone.
  Durations: beast `~/omb-fork/pnpm-store/test-durations.json` (`/store` in the container).
- E2e fixtures: `scripts/control-omb.ts` (`launchVerificationServer`), scripted
  engines `server/testing/fake-claude-cli.ts`, plans `server/testing/room-handoff-agent.ts`.
- Tool catalog size is budgeted: `server/drivers/agents-catalog-wire.test.ts`
  (`FORK_EXTRA_BYTES`; regenerate goldens with
  `UPDATE_AGENTS_CATALOG_GOLDENS=1`).
- `fork/deploy-beast.sh [--instance NAME | --all] [--force] [--allow-rollback]`: build the current
  commit on beast, back up, roll out, health check (≈30 s). Instances (container, port, live/data dir,
  ssh host or jump chain `hop>container>target>vm`, e.g. ripal via beast → omb → node1 → incus VM)
  live in `fork/instances.tsv`; default `jabeja`. Another host gets the release copied from
  beast; `on_host`/`copy_to_host` in the script are the one way to reach a host. Refuses when live has commits HEAD lacks (rebase on fork/main), one rollout at a time per host
  (`~/omb-fork/deploy.lock`), waits for the BUILD_/DEPLOY_OK/FAIL log lines.

## Office view (3D)
- Switch: `src/lib/office-view.ts`; page: `src/components/office/OfficeView.tsx`; three.js scene
  (lazy): `office-scene.ts`; rail/search: `OfficeStatusRail.tsx`, `OfficeSearch.tsx`.
- Rules live in `src/lib/office-*.ts`, each tested: desks and seats (`office-layout`),
  status and which thread a click opens (`office-status`), search ranking (`office-search`),
  cached chats (`office-recent`), motion (`office-motion`), who works for whom — the
  delegation arcs, from each thread's `openedBy` (`office-delegations`).
- The building: `office-layout` (closed offices on a corridor grid, `rooms`), drawn by
  `components/office/office-building.ts` (walls drop to a rail when they face the camera,
  glass fronts, window walls, lamps). Light follows the real sky over Brussels
  (`office-daylight`, sun position + phases, never a jump between minutes).
- Furniture: Kenney Furniture Kit (CC0) in `public/office/furniture`, sizes, palette and
  placement in `office-furniture`, loaded by `office-furniture-kit.ts`.
- Team looks (wall colour + logo, or else the name in a text colour): `server/team-looks.ts`
  + `server/routes/fork-office.ts` (`/api/team-looks`: everyone reads, admin writes; logos
  only PNG/JPEG/WebP data URLs), client rule `office-team-looks` (`wallSignFor`: logo wins,
  a text colour only counts without one; `logoSize`: how big a sign hangs), editor
  `OfficeLookEditor.tsx`. Team names over the doors show only on hover (touch: always).
- Wandering: idle non-chief bots walk the corridors now and then (`office-wander`: who,
  when — seeded so every screen agrees — and the route); `office-walker.ts` animates it.
  A bot in a handoff (either end) walks back to its desk, and its delegation arc follows
  it there (arc ends are read from the markers every frame, never fixed at creation).
- Motion, so the open animation never stutters again: moves advance by capped frames
  (`advance`), never wall time; while a panel opens, the view's shift is solved each frame
  so the bot glides straight to the visible middle (`glideShift`; easing the shift on its
  own overshoots); opening a panel is ONE movement — slide and flight share `PANEL_MOVE_MS` and
  `EASE_IN_OUT_CSS` (a panel on its own faster curve reads as a jolt); OfficeView sets all
  state and renders the chat first, starts the move from `ChatReady`, and keeps the chats
  memoised (`OfficeChats`) so no re-render (hover, a state change) lands mid-move.
  Closing flies back to the view from before the panel opened (`returnView`), with the slide.
  The office's boxes are `overflow-clip`, never `overflow-hidden`: the off-screen panel's
  composer takes focus and the browser scrolls a hidden-overflow box sideways (the whole
  office jumps ~700px, then slides back).
  Check a change by tracing frames in headless Chrome (bot screen x must never reverse,
  the canvas must stay at x=0).
