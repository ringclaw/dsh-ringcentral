import { describe, it, expect } from "vitest";
import {
  ThreadParticipationTracker,
  resolveReplyTransport,
  channelSetMatches,
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
  it("returns empty when replyToMode is off", () => {
    expect(resolveReplyTransport({ chatId: "c", replyToId: "p", replyToMode: "off" })).toEqual({});
  });

  it("returns empty for noThreadChannels", () => {
    expect(
      resolveReplyTransport({ chatId: "c", replyToId: "p", replyToMode: "first", noThreadChannels: ["c"] }),
    ).toEqual({});
  });

  it("prefers threadId", () => {
    expect(resolveReplyTransport({ chatId: "c", replyToId: "p", threadId: "t", replyToMode: "all" })).toEqual({
      threadId: "t",
    });
  });

  it("first mode suppresses threading after bot already replied to that post", () => {
    const tracker = new ThreadParticipationTracker();
    tracker.remember("p");
    expect(
      resolveReplyTransport({ chatId: "c", replyToId: "p", replyToMode: "first", tracker }),
    ).toEqual({});
  });

  it("first mode threads first reply to a post", () => {
    const tracker = new ThreadParticipationTracker();
    expect(
      resolveReplyTransport({ chatId: "c", replyToId: "p", replyToMode: "first", tracker }),
    ).toEqual({ parentPostId: "p" });
  });

  it("all mode always threads", () => {
    const tracker = new ThreadParticipationTracker();
    tracker.remember("p");
    expect(
      resolveReplyTransport({ chatId: "c", replyToId: "p", replyToMode: "all", tracker }),
    ).toEqual({ parentPostId: "p" });
  });
});

describe("channelSetMatches", () => {
  it("matches wildcard and exact id", () => {
    expect(channelSetMatches(["*"], "c1")).toBe(true);
    expect(channelSetMatches(["c1"], "c1")).toBe(true);
    expect(channelSetMatches(["c2"], "c1")).toBe(false);
    expect(channelSetMatches(undefined, "c1")).toBe(false);
  });
});
