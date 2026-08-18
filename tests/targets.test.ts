import { describe, it, expect } from "vitest";
import {
  parseTarget,
  buildUserTarget,
  buildTeamTarget,
  buildGroupTarget,
  buildChannelTarget,
  extractChatId,
  normalizeTarget,
} from "../src/ringcentral/targets.js";

describe("parseTarget", () => {
  it("parses canonical targets", () => {
    expect(parseTarget("user:123")).toEqual({ kind: "user", id: "123" });
    expect(parseTarget("team:g-1")).toEqual({ kind: "team", id: "g-1" });
    expect(parseTarget("group:g-2")).toEqual({ kind: "group", id: "g-2" });
    expect(parseTarget("channel:g-3")).toEqual({ kind: "channel", id: "g-3" });
  });

  it("rejects bare ids and legacy prefixes", () => {
    expect(parseTarget("123")).toBeNull();
    expect(parseTarget("ringcentral:123")).toBeNull();
    expect(parseTarget("rc:123")).toBeNull();
    expect(parseTarget("bogus:123")).toBeNull();
  });

  it("rejects empty id", () => {
    expect(parseTarget("user:")).toBeNull();
  });
});

describe("buildTarget", () => {
  it("builds canonical targets", () => {
    expect(buildUserTarget("1")).toBe("user:1");
    expect(buildTeamTarget("g")).toBe("team:g");
    expect(buildGroupTarget("g")).toBe("group:g");
    expect(buildChannelTarget("g")).toBe("channel:g");
  });
});

describe("extractChatId / normalizeTarget", () => {
  it("extracts chat id only for non-user targets", () => {
    expect(extractChatId("team:g-1")).toBe("g-1");
    expect(extractChatId("user:123")).toBeNull();
    expect(extractChatId("g-1")).toBeNull();
  });

  it("normalizes canonical targets", () => {
    expect(normalizeTarget(" team:g-1 ")).toBe("team:g-1");
    expect(normalizeTarget("123")).toBeUndefined();
  });
});
