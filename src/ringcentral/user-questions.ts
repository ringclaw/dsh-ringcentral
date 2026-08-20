/**
 * RingCentral userQuestions provider — agent 提问（ask_user_question）在聊天内收发答案。
 *
 * dsh 的 `ctx.userQuestions` seam 注释明确 "UI packages provide the single active
 * provider"：IM channel 同样是合法的 provider 注册方。当 agent 调用 ask_user_question
 * 时，`ask()` 把问题渲染成 RingCentral 帖子并阻塞等待；用户在会话内回复后，
 * `tryAnswer()` 解析答案并 resolve，turn 继续。
 *
 * 契约（dsh-tool-ask-user / dsh-user-questions）：
 *   ask({ questions, agent?, signal }) → Promise<{ answers: [{ id, selected, custom? }] }>
 */
import type { SessionManager, SessionRecord, DshAgent } from '../session/index.js';
import type { Logger } from '../types.js';

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  id: string;
  question: string;
  header?: string;
  options?: UserQuestionOption[];
  multiSelect?: boolean;
}

export interface UserAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

export interface UserQuestionRequest {
  questions: UserQuestion[];
  agent?: unknown;
  signal?: AbortSignal;
}

export interface UserQuestionsProviderDeps {
  manager: SessionManager;
  logger: Logger;
  /** 把问题/提示发送到会话对应的聊天（线程锚定 + Mini-Markdown 由 gateway 注入） */
  sendQuestion(record: SessionRecord, text: string): Promise<void>;
}

/** 等待用户作答的超时（ms） */
export const USER_QUESTION_TIMEOUT_MS = 10 * 60_000;

interface PendingAsk {
  sessionId: string;
  record: SessionRecord;
  questions: UserQuestion[];
  answers: UserAnswer[];
  nextIndex: number;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  abortHandler: (() => void) | undefined;
  resolve: (value: { answers: UserAnswer[] }) => void;
  reject: (err: Error) => void;
}

export class RingCentralUserQuestionsProvider {
  private readonly pending = new Map<string, PendingAsk>();

  constructor(private readonly deps: UserQuestionsProviderDeps) {}

  /**
   * 渲染问题到聊天并等待用户作答。
   * 找不到发起提问的 RingCentral 会话时立即抛错（正常不会发生）。
   */
  async ask(request: UserQuestionRequest): Promise<{ answers: UserAnswer[] }> {
    const record = this.deps.manager.findByAgent(request.agent as DshAgent);
    if (!record) {
      throw new Error('im-ringcentral: user question raised outside a RingCentral session');
    }
    const sessionId = record.sessionId;
    if (this.pending.has(sessionId)) {
      throw new Error('im-ringcentral: another user question is already pending for this session');
    }

    return new Promise<{ answers: UserAnswer[] }>((resolve, reject) => {
      const pending: PendingAsk = {
        sessionId,
        record,
        questions: request.questions,
        answers: [],
        nextIndex: 0,
        settled: false,
        timer: undefined,
        abortHandler: undefined,
        resolve,
        reject,
      };
      this.pending.set(sessionId, pending);

      // 超时兜底
      pending.timer = setTimeout(() => {
        if (pending.settled) return;
        this.settle(sessionId);
        void this.deps
          .sendQuestion(record, '⏰ 等待回答超时（10 分钟），本次提问已取消。请重新发送你的问题。')
          .catch(() => {});
        reject(new Error('user question timed out'));
      }, USER_QUESTION_TIMEOUT_MS);

      // turn 取消 / 插件卸载
      if (request.signal) {
        pending.abortHandler = () => {
          if (pending.settled) return;
          this.settle(sessionId);
          reject(new Error('user question aborted'));
        };
        request.signal.addEventListener('abort', pending.abortHandler, { once: true });
      }

      // 发送当前问题（发送失败视为 ask 失败）
      void (async () => {
        try {
          const question = pending.questions[0];
          if (question) {
            await this.deps.sendQuestion(record, renderQuestion(question, 0, pending.questions.length));
          }
        } catch (err) {
          if (!pending.settled) {
            this.settle(sessionId);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      })();
    });
  }

  /**
   * 尝试用入站消息作答该会话的 pending 提问。
   * @returns 是否消费了该消息（true = 消息是答案，不再进入 agent followup）
   */
  tryAnswer(sessionId: string, rawText: string): boolean {
    const pending = this.pending.get(sessionId);
    if (!pending) return false;

    const question = pending.questions[pending.nextIndex];
    if (!question) return false;

    const text = rawText.trim();
    const answer = parseAnswer(question, text);
    if (!answer) {
      // 有选项但未匹配：提示重选，保持 pending
      void this.deps.sendQuestion(pending.record, renderHint(question)).catch(() => {});
      return true;
    }

    pending.answers[pending.nextIndex] = answer;
    pending.nextIndex += 1;

    if (pending.nextIndex >= pending.questions.length) {
      this.settle(sessionId);
      pending.resolve({ answers: pending.answers });
      return true;
    }

    // 多问题：逐题作答，渲染下一题
    const next = pending.questions[pending.nextIndex];
    if (next) {
      void this.deps
        .sendQuestion(pending.record, renderQuestion(next, pending.nextIndex, pending.questions.length))
        .catch(() => {});
    }
    return true;
  }

  /** 是否有 pending 提问（测试/诊断用） */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** 插件卸载：拒绝全部 pending 并清理 */
  dispose(): void {
    for (const [sessionId, pending] of this.pending) {
      this.settle(sessionId);
      pending.reject(new Error('im-ringcentral channel disposed'));
    }
  }

  private settle(sessionId: string): void {
    const pending = this.pending.get(sessionId);
    if (!pending || pending.settled) return;
    pending.settled = true;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(sessionId);
  }
}

// ── 渲染与解析 ──

/** 渲染一个问题（含多问题进度） */
function renderQuestion(question: UserQuestion, index: number, total: number): string {
  const lines: string[] = [];
  if (question.header) {
    lines.push('## ' + question.header, '');
  }
  const progress = total > 1 ? '（' + (index + 1) + '/' + total + '）' : '';
  lines.push('❓ ' + question.question + progress, '');

  const options = question.options ?? [];
  if (options.length > 0) {
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      if (!option) continue;
      lines.push('- ' + (i + 1) + '. **' + option.label + '**' + (option.description ? ' — ' + option.description : ''));
    }
    lines.push(
      '',
      question.multiSelect ? '回复选项序号（可多选，如 "1, 3"）或选项内容作答。' : '回复选项序号或选项内容作答。',
    );
  } else {
    lines.push('直接回复你的答案。');
  }
  return lines.join('\n');
}

/** 选项未匹配时的重选提示 */
function renderHint(question: UserQuestion): string {
  const lines: string[] = ['⚠️ 没有匹配到可选项，请回复序号或选项内容：', ''];
  const options = question.options ?? [];
  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    if (!option) continue;
    lines.push('- ' + (i + 1) + '. **' + option.label + '**');
  }
  return lines.join('\n');
}

/** 解析一条作答：无选项 → custom 文本；有选项 → label/序号/多选匹配，未匹配返回 null */
function parseAnswer(question: UserQuestion, text: string): UserAnswer | null {
  const options = question.options ?? [];
  if (options.length === 0) {
    return { id: question.id, selected: [], custom: text };
  }

  const selections = question.multiSelect
    ? text.split(/[,，、;；]/).map((part) => part.trim()).filter(Boolean)
    : [text];
  if (selections.length === 0) return null;

  const selected: string[] = [];
  for (const raw of selections) {
    const matched = matchOption(options, raw);
    if (!matched) return null;
    selected.push(matched.label);
  }
  return { id: question.id, selected };
}

function matchOption(options: UserQuestionOption[], raw: string): UserQuestionOption | null {
  // 1-based 序号（"1"、"2"）
  if (/^\d+$/.test(raw)) {
    const index = Number(raw) - 1;
    if (index >= 0 && index < options.length) return options[index] ?? null;
  }
  const lower = raw.toLowerCase();
  return options.find((option) => option.label.trim().toLowerCase() === lower) ?? null;
}
