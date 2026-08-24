/**
 * 轮换调度器：多源变更事件 → debounce 合并 → 单飞执行。
 *
 * 从 index.ts 抽出以便单测。行为契约：
 * - debounce 窗口内的连续 schedule 合并为一次执行，携带最后一次 source；
 * - 执行期间的新 schedule 复用同一 in-flight promise（单飞，不重入）；
 * - dispose 取消未执行的定时器。
 */
export interface RotationScheduler {
  schedule(source: string): void;
  dispose(): void;
}

export function createRotationScheduler(
  run: (source: string) => Promise<boolean>,
  options: { debounceMs?: number } = {},
): RotationScheduler {
  const debounceMs = options.debounceMs ?? 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<boolean> | undefined;

  const execute = (source: string): Promise<boolean> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        return await run(source);
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  return {
    schedule(source: string): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void execute(source);
      }, debounceMs);
    },
    dispose(): void {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
