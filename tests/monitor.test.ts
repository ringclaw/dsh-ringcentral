import { describe, it, expect } from "vitest";
import {
  extractPostFromWsFrame,
  shouldProcessPost,
  buildWebSocketUrl,
} from "../src/ringcentral/monitor.js";
import { ANSWER_START } from "../src/ringcentral/shared.js";
import type { Post } from "../src/ringcentral/types.js";

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "p1",
    groupId: "g1",
    creatorId: "u1",
    text: "hello",
    type: "TextMessage",
    eventType: "PostAdded",
    ...overrides,
  } as Post;
}

describe("extractPostFromWsFrame", () => {
  it("extracts from the two-element frame shape (body.eventType)", () => {
    const frame = [{ type: "ClientRequest" }, { event: "/team-messaging/v1/posts", body: post() }];
    expect(extractPostFromWsFrame(frame)).toMatchObject({ id: "p1", text: "hello" });
  });

  it("extracts from the single-object shape via record.event includes PostAdded", () => {
    const frame = { event: "/restapi/v1.0/glip/posts/PostAdded", body: post({ eventType: undefined }) };
    expect(extractPostFromWsFrame(frame)).toMatchObject({ id: "p1" });
  });

  it("rejects frames without a PostAdded event", () => {
    const frame = [{ type: "ClientRequest" }, { event: "/other", body: post({ eventType: undefined }) }];
    expect(extractPostFromWsFrame(frame)).toBeNull();
  });

  it("rejects non-TextMessage posts", () => {
    const frame = [{}, { body: post({ type: "Card" }) }];
    expect(extractPostFromWsFrame(frame)).toBeNull();
  });

  it("rejects posts without a string text", () => {
    const frame = [{}, { body: post({ text: undefined as unknown as string }) }];
    expect(extractPostFromWsFrame(frame)).toBeNull();
  });

  it("rejects non-object frames", () => {
    expect(extractPostFromWsFrame(null)).toBeNull();
    expect(extractPostFromWsFrame("junk")).toBeNull();
  });
});

describe("shouldProcessPost", () => {
  it("drops posts already marked as sent", () => {
    const sentPosts = new Map([["p1", Date.now()]]);
    expect(shouldProcessPost(post(), { sentPosts })).toBe(false);
  });

  it("drops own posts by creator id (fixed value)", () => {
    expect(shouldProcessPost(post({ creatorId: "me" }), { ownCreatorId: "me" })).toBe(false);
    expect(shouldProcessPost(post({ creatorId: "other" }), { ownCreatorId: "me" })).toBe(true);
  });

  // 注：getter 形式的 ownCreatorId 由 RingCentralWebSocketMonitor.handlePost
  // 在调用本函数前求值（轮换语义），纯函数只接受已解析的字符串。

  it("keeps posts when own-filtering is disabled", () => {
    expect(shouldProcessPost(post({ creatorId: "me" }), { ownCreatorId: "me", filterOwnCreator: false })).toBe(true);
  });

  it("drops answer-marker and ignored texts", () => {
    expect(shouldProcessPost(post({ text: ANSWER_START + "..." }))).toBe(false);
    expect(shouldProcessPost(post({ text: "ignored" }), { ignoredTexts: ["ignored"] })).toBe(false);
  });

  it("admits ordinary posts", () => {
    expect(shouldProcessPost(post())).toBe(true);
  });
});

describe("buildWebSocketUrl", () => {
  const uri = "wss://us-01.ws-api.ringcentral.com/ws";

  it("returns the bare uri without an access token", () => {
    expect(buildWebSocketUrl({ uri })).toBe(uri);
  });

  it("appends the access token as a query parameter", () => {
    const out = buildWebSocketUrl({ uri, ws_access_token: "tok" });
    expect(out).toBe(uri + "?access_token=tok");
  });

  it("does not duplicate an existing access token", () => {
    const withToken = uri + "?access_token=old";
    expect(buildWebSocketUrl({ uri: withToken, ws_access_token: "new" })).toBe(withToken);
  });
});
