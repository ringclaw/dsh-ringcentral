/**
 * 出站处理器 — dsh session/event → RingCentral 消息发送
 *
 * RingCentral 无流式 API：采用「整段发送 + 处理占位消息」策略。
 * - assistant/chunk 累积到会话 buffer（同时确保处理占位消息已创建）
 * - assistant/message / turn/end 时删除占位消息，转换 Mini-Markdown → 切分 → 逐段发送
 * - 工具结果错误始终展示，成功结果按 config 开关
 */
import type { SessionManager, SessionRecord } from '../session/index.js';
import type { ImRingCentralConfig } from '../config.js';
import type { Logger } from '../types.js';
import { chunkText, markdownToMiniMarkdown } from '../ringcentral/markdown.js';
import { formatToolResult, type ToolsRegistryLike, type ToolResultData } from './tool-presenter.js';
import {
  parseEvent,
  extractTurnError,
  type ChunkEvent,
  type MessageEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type TurnEndEvent,
  type RawSessionEvent,
} from './events.js';

export type { ToolsRegistryLike } from './tool-presenter.js';

/** 出站处理器签名（注册到 ctx.on('session/event')） */
export type OutboundHandler = (session: SessionLike, event: RawSessionEvent) => void;

/** dsh Session 简化类型 */
export interface SessionLike {
  header: { id: string };
}

/** RingCentral 发送接口（由 gateway 组装注入） */
export interface RingCentralSender {
  send(opts: {
    chatId: string;
    text: string;
    replyToId?: string;
    threadId?: string;
    convertMarkdown?: boolean;
  }): Promise<{ postId: string } | null>;
  update(chatId: string, postId: string, text: string, convertMarkdown?: boolean): Promise<void>;
  remove(chatId: string, postId: string): Promise<void>;
}

/** 工具调用记录（tool/call 建立，tool/result 消费） */
interface ToolCallRecord {
  name: string;
  args: string;
}

/** 处理占位消息状态 */
interface PlaceholderState {
  postId: string;
  editTimer: ReturnType<typeof setTimeout> | undefined;
  failsafeTimer: ReturnType<typeof setTimeout> | undefined;
}

/** 不展示给用户的轮次错误码（底层传输/网络错误，对用户无意义，且常被重试兜住） */
const SILENT_TURN_ERROR_CODES = new Set(['STREAM_CLOSED']);

/** 占位消息兜底清理时间 */
const PLACEHOLDER_FAILSAFE_MS = 2 * 60_000;

/**
 * 出站路由器：持有会话级状态，按事件类型分发到处理器
 */
class OutboundRouter {
  private readonly buffers = new Map<string, string>();
  private readonly placeholders = new Map<string, PlaceholderState>();
  private readonly placeholderInflight = new Map<string, Promise<void>>();
  private readonly toolCalls = new Map<string, ToolCallRecord>();

  public constructor(
    private readonly manager: SessionManager,
    private readonly sender: RingCentralSender,
    private readonly config: ImRingCentralConfig,
    private readonly logger: Logger,
    private readonly toolsRegistry: ToolsRegistryLike | undefined,
  ) {}

  /** 事件分发入口 */
  public route(session: SessionLike, raw: RawSessionEvent): void {
    const event = parseEvent(raw);
    if (event === undefined) return;

    const record = this.manager.findBySessionId(session.header.id);
    if (record === undefined) return;

    switch (event.type) {
      case 'assistant/chunk':
        this.onChunk(session.header.id, record, event);
        break;
      case 'assistant/message':
        this.onMessage(session.header.id, record, event);
        break;
      case 'tool/call':
        this.onToolCall(session.header.id, record, event);
        break;
      case 'tool/result':
        this.onToolResult(record, event);
        break;
      case 'turn/end':
        this.onTurnEnd(session.header.id, record, event);
        break;
    }
  }

  /** 流式文本增量：累积到会话 buffer，并确保占位消息已创建 */
  private onChunk(sessionId: string, record: SessionRecord, event: ChunkEvent): void {
    const current = this.buffers.get(sessionId) ?? '';
    this.buffers.set(sessionId, current + event.text);
    void this.ensurePlaceholder(sessionId, record);
  }

  /** 完整 assistant 消息：有 buffer 则 flush，否则直接发送文本块 */
  private onMessage(sessionId: string, record: SessionRecord, event: MessageEvent): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer !== undefined && buffer.trim()) {
      void this.flush(sessionId, record, buffer);
      this.buffers.delete(sessionId);
      return;
    }

    const textParts: string[] = [];
    for (const block of event.content) {
      if (block.type === 'text' && block.text) textParts.push(block.text);
    }
    const fullText = textParts.join('\n');
    if (!fullText.trim()) {
      this.buffers.delete(sessionId);
      return;
    }

    void this.flush(sessionId, record, fullText);
    this.buffers.delete(sessionId);
  }

  /** 工具调用：记录并确保占位消息存在（工具执行期间的等待信号） */
  private onToolCall(sessionId: string, record: SessionRecord, event: ToolCallEvent): void {
    this.toolCalls.set(event.callId, { name: event.name, args: event.arguments });
    void this.ensurePlaceholder(sessionId, record);
  }

  /** 工具结果：错误始终发送，成功结果按开关 */
  private onToolResult(record: SessionRecord, event: ToolResultEvent): void {
    const call = this.toolCalls.get(event.callId);
    this.toolCalls.delete(event.callId);
    if (call === undefined) return;

    if (event.error === undefined && !this.config.showToolResults) return;

    const text = formatToolResult(
      call.name,
      call.args,
      event.raw as unknown as ToolResultData,
      this.toolsRegistry,
      record.agent,
    );
    if (!text) return;

    void this.send(record, text);
  }

  /** 轮次结束：flush 剩余 buffer，异常结束时告知用户 */
  private onTurnEnd(sessionId: string, record: SessionRecord, event: TurnEndEvent): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer !== undefined && buffer.trim()) {
      void this.flush(sessionId, record, buffer);
    } else {
      void this.clearPlaceholder(sessionId);
    }
    this.buffers.delete(sessionId);

    const failure = extractTurnError(event.reason);
    if (failure !== undefined && !SILENT_TURN_ERROR_CODES.has(failure.code)) {
      void this.send(record, '⚠️ 本轮异常结束\n`' + failure.code + '`: ' + failure.message);
    }

    this.logger.debug('im-ringcentral: turn/end sessionId=' + sessionId);
  }

  /** flush：删除占位 → 转 Mini-Markdown → 切分 → 逐段发送 */
  private async flush(sessionId: string, record: SessionRecord, text: string): Promise<void> {
    await this.clearPlaceholder(sessionId);
    await this.send(record, text);
  }

  /** 统一发送：切分 + 逐 chunk 发送 + 错误记录 */
  private async send(record: SessionRecord, text: string): Promise<void> {
    const mini = markdownToMiniMarkdown(text);
    if (!mini.trim()) return;
    const chunks = chunkText(mini, this.config.textChunkLimit);
    for (const chunk of chunks) {
      try {
        await this.sender.send({
          chatId: record.replyTarget.chatId,
          text: chunk,
          replyToId: record.replyTarget.replyToId,
          threadId: record.replyTarget.threadId,
          convertMarkdown: false,
        });
      } catch (err) {
        this.logger.error('im-ringcentral: send failed: ' + (err instanceof Error ? err.message : String(err)));
      }
    }
  }

  // ── 处理占位消息生命周期 ──

  /**
   * 创建处理占位消息（👀）。并发安全：同一会话同一时刻最多一个在途创建，
   * 避免 assistant/chunk 突发时重复发送占位消息（孤儿 👀 无法被清理）。
   */
  private ensurePlaceholder(sessionId: string, record: SessionRecord): Promise<void> {
    const placeholder = this.config.processingPlaceholder;
    if (!placeholder.enabled || this.placeholders.has(sessionId)) return Promise.resolve();

    const inflight = this.placeholderInflight.get(sessionId);
    if (inflight) return inflight;

    const creation = this.createPlaceholder(sessionId, record).finally(() => {
      if (this.placeholderInflight.get(sessionId) === creation) {
        this.placeholderInflight.delete(sessionId);
      }
    });
    this.placeholderInflight.set(sessionId, creation);
    return creation;
  }

  private async createPlaceholder(sessionId: string, record: SessionRecord): Promise<void> {
    const placeholder = this.config.processingPlaceholder;
    try {
      const result = await this.sender.send({
        chatId: record.replyTarget.chatId,
        text: placeholder.initialText,
        replyToId: record.replyTarget.replyToId,
        threadId: record.replyTarget.threadId,
        convertMarkdown: false,
      });
      if (!result) return;
      const state: PlaceholderState = { postId: result.postId, editTimer: undefined, failsafeTimer: undefined };
      this.placeholders.set(sessionId, state);

      // 延迟编辑：👀 → ⏳
      const { delayedText, editDelaySeconds } = placeholder;
      if (delayedText && delayedText !== placeholder.initialText && editDelaySeconds > 0) {
        state.editTimer = setTimeout(() => {
          state.editTimer = undefined;
          void this.sender
            .update(record.replyTarget.chatId, state.postId, delayedText, false)
            .catch((err) => this.logger.warn('im-ringcentral: placeholder edit failed: ' + (err instanceof Error ? err.message : String(err))));
        }, editDelaySeconds * 1000);
      }

      // 兜底清理：防止异常路径下占位消息悬挂
      state.failsafeTimer = setTimeout(() => {
        state.failsafeTimer = undefined;
        if (this.placeholders.get(sessionId)?.postId === state.postId) {
          void this.clearPlaceholder(sessionId);
        }
      }, PLACEHOLDER_FAILSAFE_MS);
    } catch (err) {
      this.logger.warn('im-ringcentral: placeholder create failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private async clearPlaceholder(sessionId: string): Promise<void> {
    // 等待在途创建先落定，避免「删除已执行、创建后到」重新注册孤儿占位
    const inflight = this.placeholderInflight.get(sessionId);
    if (inflight) {
      try {
        await inflight;
      } catch {
        // 创建失败无需处理
      }
    }
    const state = this.placeholders.get(sessionId);
    if (!state) return;
    this.placeholders.delete(sessionId);

    if (state.editTimer) clearTimeout(state.editTimer);
    if (state.failsafeTimer) clearTimeout(state.failsafeTimer);

    const record = this.manager.findBySessionId(sessionId);
    if (!record) return;
    try {
      await this.sender.remove(record.replyTarget.chatId, state.postId);
    } catch (err) {
      this.logger.warn('im-ringcentral: placeholder delete failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }
}

/**
 * 创建出站事件处理器
 *
 * 返回一个 handler 函数，应注册到 ctx.on('session/event', handler)。
 * toolsRegistry 用于工具结果的结构化展示（参考 dsh-TUI 的 presentResult）。
 */
export function createOutboundHandler(
  manager: SessionManager,
  sender: RingCentralSender,
  config: ImRingCentralConfig,
  logger: Logger,
  toolsRegistry?: ToolsRegistryLike,
): OutboundHandler {
  const router = new OutboundRouter(manager, sender, config, logger, toolsRegistry);
  return (session, event) => router.route(session, event);
}
