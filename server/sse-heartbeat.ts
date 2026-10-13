// Jabeja fork: the SSE heartbeat of one event stream.
//
// A stream ended elsewhere (an audience change, a revoked session) stays
// open until a slow client has drained it; a phone in the background behind
// the proxy can take longer than a heartbeat. A heartbeat written meanwhile
// is a write after end, whose 'error' event nobody handles, and that took the
// whole server down (live 2026-10-09 and 2026-10-13; the unclean restart
// then dropped every email sign-in).

import type { ServerResponse } from "node:http";

type Stream = Pick<ServerResponse, "write" | "end" | "writableEnded" | "destroyed">;

/** Writes `frame` every `intervalMs`; ends the stream once `live()` says no.
 * Stops by itself once the stream has ended; returns the stop function. */
export function startSseHeartbeat(res: Stream, intervalMs: number, frame: string, live: () => boolean): () => void {
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) return clearInterval(timer);
    if (!live()) {
      res.end();
      return clearInterval(timer);
    }
    try {
      res.write(frame);
    } catch {}
  }, intervalMs);
  return () => clearInterval(timer);
}
