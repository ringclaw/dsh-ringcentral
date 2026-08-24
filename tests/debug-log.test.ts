import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { debugLog, debugLogPath } from "../src/debug-log.js";

// 隔离 HOME：debug 文件写入临时目录
const originalHome = process.env.HOME;
const testHome = mkdtempSync(join(tmpdir(), "dsh-ringcentral-debuglog-"));
process.env.HOME = testHome;

afterAll(() => {
  process.env.HOME = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});

describe("debugLog", () => {
  beforeAll(() => {
    const file = debugLogPath();
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  });

  it("writes a timestamped line when enabled", () => {
    debugLog(true, "[test] hello");
    const content = readFileSync(debugLogPath(), "utf8");
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[test\] hello$/m);
  });

  it("is a no-op when disabled", () => {
    debugLog(false, "[test] silent");
    const content = readFileSync(debugLogPath(), "utf8");
    expect(content).not.toContain("[test] silent");
  });

  it("creates the directory on first write", () => {
    expect(existsSync(debugLogPath())).toBe(true);
  });
});
