import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRotationScheduler } from "../src/rotation-scheduler.js";

describe("createRotationScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges bursts within the debounce window into one run, carrying the last source", async () => {
    const run = vi.fn(async () => true);
    const scheduler = createRotationScheduler(run, { debounceMs: 1000 });

    scheduler.schedule("a");
    scheduler.schedule("b");
    scheduler.schedule("c");
    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("c");
    scheduler.dispose();
  });

  it("is single-flight: a schedule during execution reuses the in-flight promise", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => {
      await gate;
      return true;
    });
    const scheduler = createRotationScheduler(run, { debounceMs: 50 });

    scheduler.schedule("first");
    await vi.advanceTimersByTimeAsync(60); // 启动第一次执行（挂起在 gate）
    scheduler.schedule("second");
    await vi.advanceTimersByTimeAsync(60); // debounce 到期，但应复用 in-flight
    expect(run).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.dispose();
  });

  it("dispose cancels a pending run", async () => {
    const run = vi.fn(async () => true);
    const scheduler = createRotationScheduler(run, { debounceMs: 1000 });
    scheduler.schedule("x");
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs again after the previous execution settles", async () => {
    const run = vi.fn(async () => true);
    const scheduler = createRotationScheduler(run, { debounceMs: 50 });
    scheduler.schedule("one");
    await vi.advanceTimersByTimeAsync(60);
    scheduler.schedule("two");
    await vi.advanceTimersByTimeAsync(60);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
});
