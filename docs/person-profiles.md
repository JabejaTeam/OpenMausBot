# A profile per person

On a workspace several people share, every bot should know who it is working
for and how that person likes to work, without one teammate's preferences
reaching another's conversation.

- **Who is asking.** Each turn done for a signed-in person starts with a short
  block naming them (`[Person: you are working for Ada (ada@example.com). …]`).
  Work a bot hands to another bot keeps the person it was for, so the next bot
  is told too. Routines and webhooks name nobody.
- **Their profile.** The same block carries that person's profile: lasting
  preferences and habits, one fact per line, at most 200 lines. Only the
  person the turn is for is ever shown.
- **Bots learn into it.** The `person_profile_update` agent tool appends,
  replaces or removes one fact. It has no "whose" argument: it always writes
  the profile of the person the conversation is for, so a bot can never change
  someone else's.
- **The person keeps it.** Settings → **About me** shows a signed-in person
  their own name and profile to read and edit (`GET`/`PUT /api/people/me`,
  client scope). Nobody sees another person's profile in the app, admins
  included.

The block rides on the turn's text rather than on the standing instructions:
an engine that keeps its instructions for a whole session (Codex) would
otherwise keep the first person's profile while someone else takes over the
thread.

Storage: `<data dir>/people/<person key>.json` (0600), keyed by the same
one-way person key as per-person MCP values. Rooms name each speaker in their
transcript but do not carry profiles yet.
