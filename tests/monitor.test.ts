import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractPostFromWsFrame,
  shouldProcessPost,
  buildWebSocketUrl,
  RingCentralWebSocketMonitor,
} from "../src/ringcentral/monitor.js";
import type { RingCentralClient } from "../src/ringcentral/client.js";
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

describe("RingCentralWebSocketMonitor connect timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("breaks the start() deadlock when the WebSocket never opens, then retries", async () => {
    // A WebSocket that stays CONNECTING forever: TCP/TLS may be up but the
    // handshake never completes — exactly the half-open case that previously
    // left start() awaiting connectAndListen forever.
    class NeverOpenWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly readyState = NeverOpenWebSocket.CONNECTING;
      url = "wss://example.invalid/ws";
      private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
      addEventListener(type: string, listener: (event: unknown) => void): void {
        let set = this.listeners.get(type);
        if (!set) {
          set = new Set();
          this.listeners.set(type, set);
        }
        set.add(listener);
      }
      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }
      send(): void {}
      close(): void {}
    }
    vi.stubGlobal("WebSocket", NeverOpenWebSocket);

    const fakeClient = {
      createWebSocketToken: async () => ({ uri: "wss://example.invalid/ws" }),
    } as unknown as RingCentralClient;

    const ac = new AbortController();
    const disconnected: unknown[] = [];
    const diagnostics: string[] = [];
    const monitor = new RingCentralWebSocketMonitor({
      client: fakeClient,
      abortSignal: ac.signal,
      onMessage: () => {},
      log: () => {},
      onDiagnostic: (event) => { diagnostics.push(event); },
      onDisconnected: (error) => { disconnected.push(error); },
      connectTimeoutMs: 40,
    });

    const started = monitor.start();
    // The timeout must fire and route into the retry loop instead of hanging.
    await vi.waitFor(() => {
      expect(diagnostics).toContain("ws_connect_timeout");
      expect(disconnected.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 2000, interval: 5 });

    ac.abort();
    await started;
    expect(disconnected[0]).toBeInstanceOf(Error);
    expect(String(disconnected[0])).toContain("connect timeout");
  });
});
