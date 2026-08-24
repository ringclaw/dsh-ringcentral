/**
 * 网关组装 — 将 RingCentral Team Messaging 作为 dsh 前端协议驱动
 *
 * 数据流：
 *   RingCentral WebSocket → handleInboundPost（准入判定 + body 组装）
 *   → SessionManager（peer → agent）→ agent.followup()
 *   dsh session/event → createOutboundHandler → RingCentral 出站（线程回复 + Mini-Markdown）
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionManager, type DshAgentRegistry } from '../session/index.js';
import { createOutboundHandler, type RingCentralSender, type ToolsRegistryLike } from '../transport/index.js';
import { buildCommandList, isCommandText, matchCommand } from '../commands/index.js';
import { createHistoryTool } from '../history-tool.js';
import type { ImRingCentralConfig } from '../config.js';
import type { Logger, ReplyTarget } from '../types.js';
import type { ResolvedAccount } from '../ringcentral/types.js';
import type { Post } from '../ringcentral/types.js';
import { RingCentralClient, createBotClient, createOwnerClient } from '../ringcentral/client.js';
import { RingCentralWebSocketMonitor } from '../ringcentral/monitor.js';
import { handleInboundPost } from '../ringcentral/inbound.js';
import { RingCentralUserQuestionsProvider } from '../ringcentral/user-questions.js';
import { sendMessage, updateMessage, deleteMessage } from '../ringcentral/send.js';
import { resolveInboundAttachmentsForAgent } from '../ringcentral/attachments.js';
import { ThreadParticipationTracker } from '../ringcentral/threading.js';
import { chunkText, markdownToMiniMarkdown } from '../ringcentral/markdown.js';
import { debugLog } from '../debug-log.js';
import { PROCESSING_PLACEHOLDER_DELAYED_TEXT, PROCESSING_PLACEHOLDER_INITIAL_TEXT } from '../ringcentral/shared.js';

/** 每 peer 待处理队列上限的清理水位（超过时丢弃最旧任务） */
const MAX_PENDING_PER_PEER = 64;

export async function bootstrapGateway(
  ctx: Context,
  agents: DshAgentRegistry,
  account: ResolvedAccount,
  config: ImRingCentralConfig,
  logger: Logger,
): Promise<void> {
  debugLog(config.debug, '[gateway] bootstrap start');
  const botClient = createBotClient(account.server, account.botToken);
  const ownerClient = account.ownerCredentials
    ? createOwnerClient(account.server, account.ownerCredentials.clientId, account.ownerCredentials.clientSecret, account.ownerCredentials.jwt)
    : undefined;
  const accountKey = botClient.getAccountScopeKey();

  // ── bot person id（过滤自身回声 / mention 检测；自动探测，失败仅告警） ──
  let botPersonId: string | undefined;
  try {
    botPersonId = String((await botClient.getExtensionInfo()).id);
    debugLog(config.debug, '[gateway] botPersonId resolved: ' + botPersonId);
  } catch {
    logger.warn('im-ringcentral: unable to resolve bot extension id; self-echo filtering degraded');
    debugLog(config.debug, '[gateway] botPersonId resolution failed (self-echo filtering degraded)');
  }

  const tracker = new ThreadParticipationTracker();
  const monitors: RingCentralWebSocketMonitor[] = [];
  const seenPostIds = new Set<string>();
  const manager = new SessionManager(ctx, agents, config, accountKey, logger);
  const commands = buildCommandList({ manager, config });

  // ── 出站发送适配器 ──
  const markOwnPost = (postId: string): void => {
    tracker.remember(postId);
    for (const monitor of monitors) {
      monitor.markOwnPost(postId);
    }
  };

  const sender: RingCentralSender = {
    send: async (opts) =>
      sendMessage({
        client: botClient,
        fallbackClient: ownerClient,
        chatId: opts.chatId,
        text: opts.text,
        replyToId: opts.replyToId,
        threadId: opts.threadId,
        tracker,
        markOwnPost,
        convertMarkdown: opts.convertMarkdown ?? true,
      }),
    update: (chatId, postId, text, convertMarkdown = true) =>
      updateMessage(botClient, chatId, postId, text, convertMarkdown),
    remove: (chatId, postId) => deleteMessage(botClient, chatId, postId),
  };

  let toolsRegistry: ToolsRegistryLike | undefined;
  try {
    toolsRegistry = ctx.get('tools') as ToolsRegistryLike | undefined;
  } catch {
    toolsRegistry = undefined;
  }

  // ── 历史工具（bot 优先、owner 回退；有 tools registry 即注册） ──
  // 注册器定义在外层作用域：tools 的 inject 回调（下方）在服务出现后触发注册。
  let unregisterHistoryTool: (() => void) | undefined;
  let historyRegistered = false;
  const registerHistoryTool = async (): Promise<void> => {
    if (historyRegistered || !toolsRegistry) return;
    historyRegistered = true; // 失败时回置，允许服务就绪后重试
    try {
      const tool = await createHistoryTool({ account, ownerClient, botClient });
      if (tool) {
        const registry = toolsRegistry as unknown as { register(definition: unknown): () => void };
        unregisterHistoryTool = registry.register(tool);
        logger.info('[ringcentral] registered ringcentral_get_recent_messages tool');
        debugLog(config.debug, '[tools] registered ringcentral_get_recent_messages tool');
      }
    } catch (err) {
      logger.warn('im-ringcentral: history tool registration failed: ' + (err instanceof Error ? err.message : String(err)));
      historyRegistered = false;
    }
  };
  const historyReady: Promise<void> = registerHistoryTool();

  // inject 跨 isolate 取 host 服务：桌面端 bundle 行 ctx.get 看不到 host 平面，
  // inject 可以（与 installSettingsSection 注入 settings 同一条路）。
  try {
    (ctx as unknown as { inject?(deps: string[], cb: (sctx: Context) => void): void })
      .inject?.(['tools'], (sctx) => {
        const injected = (sctx as unknown as Record<string, unknown>).tools as ToolsRegistryLike | undefined;
        if (injected && !toolsRegistry) {
          toolsRegistry = injected;
          debugLog(config.debug, '[tools] inject: tools registry available');
          void registerHistoryTool();
        }
      });
  } catch (err) {
    logger.warn('im-ringcentral: tools inject failed: ' + (err instanceof Error ? err.message : String(err)));
  }

  const outboundHandler = createOutboundHandler(manager, sender, config, logger, toolsRegistry);
  (ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void): void })
    .on('session/event', outboundHandler as (...args: unknown[]) => void);

  // ── 入站：每 peer 串行队列（避免同会话并发 followup 冲突） ──
  const queues = new Map<string, Promise<void>>();

  const enqueue = (chatId: string, task: () => Promise<void>): void => {
    const prev = queues.get(chatId) ?? Promise.resolve();
    const next = prev.then(task).catch((err) => {
      logger.error('im-ringcentral: inbound task failed: ' + (err instanceof Error ? err.message : String(err)));
    });
    queues.set(chatId, next);
    if (queues.size > MAX_PENDING_PER_PEER) {
      // 防御性清理：删除已完成队列条目
      for (const [key, promise] of queues) {
        if (promise === next) continue;
        void promise;
        queues.delete(key);
        if (queues.size <= MAX_PENDING_PER_PEER) break;
      }
    }
  };

  const log = (message: string): void => {
    logger.info(message);
    debugLog(config.debug, message);
  };

  const getPersonInfo = async (personId: string) => {
    const client: RingCentralClient = ownerClient ?? botClient;
    return await client.getPersonInfo(personId).catch(() => null);
  };

  const getChatInfo = async (chatId: string) => {
    return await botClient.getChat(chatId).catch(() => null);
  };

  const downloadAttachments = async (post: Post) =>
    resolveInboundAttachmentsForAgent({
      attachments: post.attachments,
      primaryClient: botClient,
      fallbackClient: ownerClient,
      cwd: config.cwd || process.cwd(),
      messageId: post.id,
      log,
    });

  const onMessage = (post: Post): void => {
    if (seenPostIds.has(post.id)) return;
    seenPostIds.add(post.id);
    if (seenPostIds.size > 5000) {
      // 简单修剪：清空旧 id（与 monitor 的 TTL 集合互补）
      seenPostIds.clear();
      seenPostIds.add(post.id);
    }
    enqueue(post.groupId, () => handlePost(post));
  };

  // ── 单条消息处理 ──
  let userQuestionsProvider: RingCentralUserQuestionsProvider | undefined;

  const handlePost = async (post: Post): Promise<void> => {
    const decision = await handleInboundPost({
      post,
      account,
      botPersonId,
      tracker,
      log,
      getPersonInfo,
      getChatInfo,
      downloadAttachments,
    });

    if (!decision.admitted) {
      if (config.debug) {
        logger.debug('im-ringcentral: inbound dropped: chatId=' + post.groupId + ' reason=' + decision.reason);
        debugLog(true, '[inbound] dropped: chatId=' + post.groupId + ' sender=' + post.creatorId + ' reason=' + decision.reason);
      }
      return;
    }

    if (config.debug) {
      logger.debug(
        'im-ringcentral: inbound admitted: chatId=' + post.groupId +
        ' sender=' + post.creatorId + ' scope=' + decision.scope +
        ' text=' + (post.text ?? '').slice(0, 120),
      );
      debugLog(true, '[inbound] admitted: chatId=' + post.groupId + ' sender=' + post.creatorId + ' scope=' + decision.scope);
    }

    const replyTarget: ReplyTarget = {
      scope: decision.scope,
      chatId: decision.chatId,
      replyToId: decision.replyToId,
      threadId: decision.threadId,
    };

    // ── 斜杠命令拦截（匹配成功则不进入 agent 轮次） ──
    if (isCommandText(decision.body)) {
      const match = matchCommand(decision.body, commands);
      if (match) {
        const reply = await match.command.handler({
          args: match.args,
          scope: decision.scope,
          peerId: decision.peerId,
          senderId: decision.senderId,
        });
        if (reply) {
          await sendReply(replyTarget, reply);
        }
        return;
      }
      // 未匹配的命令文本：按普通消息继续
    }

    // ── pending 提问的答案消费（agent ask_user 等待期间，同会话消息即作答） ──
    if (userQuestionsProvider) {
      const active = manager.getSessionRecord(decision.scope, decision.peerId);
      if (active && userQuestionsProvider.tryAnswer(active.sessionId, decision.text)) {
        if (config.debug) {
          logger.debug('im-ringcentral: inbound message consumed as user-question answer');
        }
        return;
      }
    }

    // ── 组装 agent body → followup ──
    let body = decision.body;
    if (decision.systemPrompt) {
      body = '[Channel instructions]\n' + decision.systemPrompt + '\n\n' + body;
    }

    logger.info('Processing: scope=' + decision.scope + ' peerId=' + decision.peerId + ' body="' + body.slice(0, 200) + '"');

    let record;
    try {
      record = await manager.getOrCreate(decision.scope, decision.peerId, decision.senderId, replyTarget);
    } catch (err) {
      logger.error('ERROR creating session: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }

    const content: ContentBlock[] = [{ type: 'text' as const, text: body }];
    const message = createUserMessage({
      content,
      source: { kind: 'user' as const },
    });

    record.agent.followup(message);
    logger.info('→ followup sent: key=' + decision.scope + ':' + decision.peerId);
  };

  /** 命令/错误等直接回复（Mini-Markdown → 切分 → 线程发送） */
  const sendReply = async (replyTarget: ReplyTarget, text: string): Promise<void> => {
    const mini = markdownToMiniMarkdown(text);
    if (!mini.trim()) return;
    for (const chunk of chunkText(mini, config.textChunkLimit)) {
      try {
        await sender.send({
          chatId: replyTarget.chatId,
          text: chunk,
          replyToId: replyTarget.replyToId,
          threadId: replyTarget.threadId,
          convertMarkdown: false,
        });
      } catch (err) {
        logger.error('im-ringcentral: reply failed: ' + (err instanceof Error ? err.message : String(err)));
      }
    }
  };

  // ── userQuestions provider（agent ask_user 的 IM 应答面；web GUI 已注册时跳过） ──
  let disposeUserQuestions: (() => void) | undefined;
  let userQuestionsRegistered = false;
  const registerUserQuestions = (
    service: { registerProvider(provider: unknown): () => void } | undefined,
  ): void => {
    if (!service || userQuestionsRegistered) return;
    try {
      userQuestionsProvider = new RingCentralUserQuestionsProvider({
        manager,
        logger,
        sendQuestion: async (record, text) => {
          await sendReply(record.replyTarget, text);
        },
      });
      disposeUserQuestions = service.registerProvider(userQuestionsProvider);
      userQuestionsRegistered = true;
      logger.info('[ringcentral] registered userQuestions provider');
      debugLog(config.debug, '[userQuestions] registered IM provider');
    } catch (err) {
      // 例如 web profile 的 GUI provider 已注册（DUPLICATE_PROVIDER）：GUI 优先，IM 作答不可用
      logger.warn('im-ringcentral: userQuestions provider registration skipped: ' + (err instanceof Error ? err.message : String(err)));
    }
  };
  try {
    registerUserQuestions(ctx.get('userQuestions') as
      | { registerProvider(provider: unknown): () => void }
      | undefined);
  } catch {
    // ctx.get 不可用/抛错时走 inject 路径
  }
  try {
    (ctx as unknown as { inject?(deps: string[], cb: (sctx: Context) => void): void })
      .inject?.(['userQuestions'], (sctx) => {
        registerUserQuestions((sctx as unknown as Record<string, unknown>).userQuestions as
          | { registerProvider(provider: unknown): () => void }
          | undefined);
      });
  } catch (err) {
    logger.warn('im-ringcentral: userQuestions inject failed: ' + (err instanceof Error ? err.message : String(err)));
  }

  // ── 生命周期 ──
  debugLog(config.debug, '[gateway] core ready, registering lifecycle effect');
  (ctx as unknown as { effect(fn: () => (() => Promise<void>) | void, name?: string): void })
    .effect(() => {
      debugLog(config.debug, '[gateway] lifecycle effect running');
      const controller = new AbortController();
      const ignoredTexts = [
        PROCESSING_PLACEHOLDER_INITIAL_TEXT,
        PROCESSING_PLACEHOLDER_DELAYED_TEXT,
      ];

      // bot 订阅（过滤自身 post）
      const botMonitor = new RingCentralWebSocketMonitor({
        client: botClient,
        ownCreatorId: botPersonId,
        filterOwnCreator: true,
        ignoredTexts,
        abortSignal: controller.signal,
        onConnected: () => {
          logger.info('[ringcentral] bot websocket connected');
          debugLog(config.debug, '[ws] bot connected');
        },
        onDisconnected: (err) => {
          logger.warn('[ringcentral] bot websocket disconnected: ' + (err?.message ?? 'unknown'));
          debugLog(config.debug, '[ws] bot disconnected: ' + (err?.message ?? 'unknown'));
        },
        onDiagnostic: (event, details) => {
          debugLog(config.debug, '[ws] ' + event + (details ? ' ' + JSON.stringify(details) : ''));
        },
        onMessage,
        log: (...args) => {
          const message = args.map(String).join(' ');
          logger.info(message);
          debugLog(config.debug, message);
        },
      });
      monitors.push(botMonitor);

      // owner 订阅（读历史；不过滤 owner 自身，用于 owner 在任意会话的发言）
      if (ownerClient) {
        const ownerMonitor = new RingCentralWebSocketMonitor({
          client: ownerClient,
          ownCreatorId: undefined,
          filterOwnCreator: false,
          ignoredTexts,
          abortSignal: controller.signal,
          onConnected: () => {
            logger.info('[ringcentral] owner websocket connected');
            debugLog(config.debug, '[ws] owner connected');
          },
          onDisconnected: (err) => {
            logger.debug('[ringcentral] owner websocket disconnected: ' + (err?.message ?? 'unknown'));
            debugLog(config.debug, '[ws] owner disconnected: ' + (err?.message ?? 'unknown'));
          },
          onDiagnostic: (event, details) => {
            debugLog(config.debug, '[ws] owner ' + event + (details ? ' ' + JSON.stringify(details) : ''));
          },
          onMessage,
          log: (...args) => {
            const message = args.map(String).join(' ');
            logger.debug(message);
            debugLog(config.debug, message);
          },
        });
        monitors.push(ownerMonitor);
      }

      // ── 历史工具注册已移至外层作用域（tools 的 inject 回调需要触达） ──

      const starts = monitors.map((monitor) =>
        monitor.start().catch((err) => {
          logger.error('im-ringcentral: monitor start failed: ' + (err instanceof Error ? err.message : String(err)));
          debugLog(config.debug, '[ws] monitor start failed: ' + (err instanceof Error ? err.message : String(err)));
        }),
      );
      debugLog(config.debug, '[gateway] monitor.start() invoked for ' + starts.length + ' monitor(s)');

      return async () => {
        logger.info('Shutting down im-ringcentral');
        controller.abort();
        await historyReady;
        disposeUserQuestions?.();
        userQuestionsProvider?.dispose();
        unregisterHistoryTool?.();
        await Promise.allSettled(starts);
        await manager.disposeAll();
        monitors.length = 0;
      };
    }, 'im-ringcentral.lifecycle');
}
