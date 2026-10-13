import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSseHeartbeat } from "./sse-heartbeat.ts";

function stream() {
  return { writableEnded: false, destroyed: false, write: vi.fn(() => true), end: vi.fn() };
}

describe("SSE heartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("beats while the stream is open", () => {
    const res = stream();
    startSseHeartbeat(res as never, 100, "ping", () => true);
    vi.advanceTimersByTime(300);
    expect(res.write).toHaveBeenCalledTimes(3);
  });

  it("never writes to a stream ended elsewhere that a slow client has not drained yet", () => {
    const res = stream();
    startSseHeartbeat(res as never, 100, "ping", () => true);
    res.writableEnded = true; // e.g. audienceChanged() ended it; 'close' has not come yet
    vi.advanceTimersByTime(1_000);
    expect(res.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends the stream of a session that is no longer live, once", () => {
    const res = stream();
    startSseHeartbeat(res as never, 100, "ping", () => false);
    vi.advanceTimersByTime(1_000);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(res.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
