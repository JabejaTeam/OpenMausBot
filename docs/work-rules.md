# Work rules by kind of bot

**Settings → Work rules** keeps the workspace's rules for how bots work, in one
place, for an admin to edit:

- **Every bot**: reaches every bot at every turn. A good home for what a bot may
  expect when it hands work to a code agent.
- **Code agents**: reaches bots whose kind is `code`, at every turn.

A bot becomes a code agent with the **Code agent** switch in its settings, when
it is created with `settings.kind: "code"` (or a New bot template that carries
it), or when a Chief of Staff creates it with `create_bot` and `kind: "code"`.

The rules are read fresh for each turn, so an edit reaches every bot of that
kind on its next turn without touching the bots themselves. They are sent as
their own system-prompt block and say they win over conflicting working rules
in a bot's own standing instructions (including what its creator wrote), its
memory, and repository files such as `AGENTS.md` or `CLAUDE.md`. A bot's own
instructions still say which project or client it works on. The rules do not
change approval levels, tools or safety boundaries.

Storage: `<data dir>/kind-instructions.json` (0600), at most 24,000 bytes per
scope. API (admin): `GET /api/kind-instructions`, `PUT
/api/kind-instructions/:scope` with `{ "text": "…" }`; empty text clears it.
