import { describe, it, expect } from "vitest";
import {
  ThreadParticipationTracker,
  resolveReplyTransport,
} from "../src/ringcentral/threading.js";

describe("ThreadParticipationTracker", () => {
  it("remembers and checks post ids", () => {
    const tracker = new ThreadParticipationTracker();
    tracker.remember("p1");
    expect(tracker.has("p1")).toBe(true);
    expect(tracker.has("p2")).toBe(false);
  });

  it("remembers threads", () => {
    const tracker = new ThreadParticipationTracker();
    tracker.rememberThread("t1");
    expect(tracker.hasThread("t1")).toBe(true);
    expect(tracker.hasThread("t2")).toBe(false);
  });

  it("ignores empty values", () => {
    const tracker = new ThreadParticipationTracker();
    tracker.remember(undefined);
    tracker.rememberThread(null);
    expect(tracker.has(undefined)).toBe(false);
    expect(tracker.hasThread(null)).toBe(false);
  });
});

describe("resolveReplyTransport", () => {
  it("prefers threadId when present", () => {
    expect(resolveReplyTransport({ replyToId: "p", threadId: "t" })).toEqual({ threadId: "t" });
  });

  it("anchors on the triggering post when no threadId", () => {
    expect(resolveReplyTransport({ replyToId: "p" })).toEqual({ parentPostId: "p" });
  });

  it("returns empty without any anchor", () => {
    expect(resolveReplyTransport({})).toEqual({});
    expect(resolveReplyTransport({ replyToId: null, threadId: null })).toEqual({});
  });
});
