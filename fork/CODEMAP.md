# Fork code map

Where things live, so a change starts at the right place instead of a search
through `server/index.ts` (23k lines). Names, not line numbers: grep them.

## Bots handing work to bots
- Tool text the models read (SSOT for how to use them): `server/drivers/agents-catalog.ts`
  (`coordinate_bots`, `relay_question`, …). Tool args → HTTP: `server/drivers/agents-call.ts`.
- `POST /api/internal/coordinate-bots` in `server/index.ts`: picks the thread
  (`store.resolvePairConversation`), `routeCorrection` for `amends`,
  `stillWorkingRefusal`, then `roomHandoffs.enqueue`.
- The handoff tree, queue and lifetimes: `server/room-handoffs.ts`
  (`enqueue`, `tick`, `amendable`, `mergeTarget`, `addCorrection`).
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

## Fork routes and people
- New fork HTTP routes go in `server/routes/fork-people.ts` (route table), not inline in index.ts.
- Thread worktrees: `server/thread-worktrees.ts`. Outgoing Gmail: `server/email-outbox.ts`.

## Tests, build, deploy (all on THE BEAST)
- `fork/test-beast.sh [--files …] [--workers N]` → `fork/test-run.mjs` in a container:
  duration-packed jobs, long files sliced by test name, failed tests rerun alone.
  Durations: beast `~/omb-fork/pnpm-store/test-durations.json`.
- E2e fixtures: `scripts/control-omb.ts` (`launchVerificationServer`), scripted
  engines `server/testing/fake-claude-cli.ts`, plans `server/testing/room-handoff-agent.ts`.
- Tool catalog size is budgeted: `server/drivers/agents-catalog-wire.test.ts`
  (`FORK_EXTRA_BYTES`, `FORK_ROOM_EXTRA_BYTES`; regenerate goldens with
  `UPDATE_AGENTS_CATALOG_GOLDENS=1`).
- `fork/deploy-beast.sh`: build the current commit on beast, back up, roll out, health check.
