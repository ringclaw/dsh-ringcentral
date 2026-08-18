# dsh-ringcentral

基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的
RingCentral Team Messaging IM 插件，将 RingCentral Bot 作为 dsh agent 的前端协议驱动：
RingCentral 入站消息驱动 agent 循环，助手回复以线程形式回到 RingCentral。

[English](./README.md) | 中文

## 架构

```
RingCentral 用户 ──▶ WebSocket (PostAdded) ──▶ im-ringcentral ──▶ ctx.agents ──▶ dsh agent loop ──▶ LLM
                                                │                                     │
                                                └── 准入 / 会话 / 事件 ◀──────────────┘
                                                     (助手回复 ──▶ RingCentral 线程帖子)
```

插件是遵循 dsh "Plugins, not loop changes" 原则的纯 Cordis 插件，直接使用
RingCentral Team Messaging v1 REST API + WebSocket 订阅流（无第三方 SDK），
并复用宿主的 agents / sessions / models / compaction / tools 服务。

## 安装

### 方式一：dsh 插件管理器

```bash
npx @deepseek-ai/dsh plugin --profile ringcentral add dsh-ringcentral

export RC_BOT_TOKEN="你的 Bot JWT"
export DEEPSEEK_API_KEY="你的 API Key"
npx @deepseek-ai/dsh --profile ringcentral
```

也可以直接执行 `sh install.sh`。

### 方式二：本地路径

```bash
cd /path/to/dsh-ringcentral
pnpm install && pnpm build
npx @deepseek-ai/dsh plugin --profile ringcentral add /path/to/dsh-ringcentral
export RC_BOT_TOKEN="你的 Bot JWT"
npx @deepseek-ai/dsh --profile ringcentral
```

### 方式三：--patch 开发模式

`--patch` overlay 通过本地绝对路径加载插件，无需安装到 profile。
先生成本机路径的 patch 文件再启动：

```bash
cd /path/to/dsh-ringcentral
pnpm install && pnpm build        # dist 入口（npx dsh 无法把 .js 解析到 .ts）
node scripts/gen-dev-patch.mjs    # 生成本机路径的 cordis.local.yml
export RC_BOT_TOKEN="你的 Bot JWT"
npx @deepseek-ai/dsh web --patch ./cordis.local.yml
```

迭代时用 `pnpm dev`（tsc --watch）：`dist/` 变化后 loader 自动热重载插件。
指向 `src/index.ts` 的入口只在 deepseek-harness 源码树内（`pnpm dsh`）可用，
`npx` 安装的 dsh 不支持。

## RingCentral Bot 配置

1. 登录 <https://developers.ringcentral.com/>。
2. 创建 **Bot** 平台类型应用。
3. 至少授予：`TeamMessaging`、`ReadAccounts`、`WebSocketsSubscription`。
4. 将 bot 安装/发布到你的 RingCentral 账号。
5. 复制 bot JWT 作为 `RC_BOT_TOKEN`。

可选 owner 凭据（owner 账号的 JWT REST API 应用，授予 `TeamMessaging` +
`WebSocketsSubscription` + `ReadMessages`）为
`ringcentral_get_recent_messages` 提供 owner 视角读取与出站 owner 回退。
未配置时历史工具仍会注册，回退到 bot 客户端读取（bot 所在的聊天）。

## 配置

插件从 dsh profile 读取配置（见 `cordis.patch.yml`），并支持 `RC_*`
环境变量覆盖。

| 配置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `botToken` | string | **必填** | Bot 静态 JWT（或 `RC_BOT_TOKEN`） |
| `ownerCredentials.clientId` / `clientSecret` / `jwt` | string | - | Owner JWT（或 `RC_USER_CLIENT_ID` / `RC_USER_CLIENT_SECRET` / `RC_USER_JWT_TOKEN`） |
| `server` | string | `https://platform.ringcentral.com` | API 服务器（或 `RC_SERVER_URL`） |
| `botExtensionId` | string | 自动探测 | Bot person id（mention/回声检测） |
| `dmPolicy` | enum | `pairing` | 私聊策略：`disabled` / `allowlist` / `pairing` / `open` |
| `allowFrom` | string[] | `[]` | 私聊白名单（stable person id，或 `RC_ALLOW_FROM`）；`open` 需包含 `"*"` |
| `dangerouslyAllowEmailMatching` | boolean | `false` | 允许按 email 别名匹配白名单 |
| `groupPolicy` | enum | `disabled` | Team/Everyone 策略：`disabled` / `allowlist` / `open` |
| `teams` | map | `{}` | 每 chat 配置：`allow`、`requireMention`、`systemPrompt`、`users`（或 `RC_TEAMS` JSON） |
| `groupDmEnabled` | boolean | `false` | 启用 Group DM（或 `RC_GROUP_DM_ENABLED`） |
| `groupDmChannels` | map | `{}` | Group DM 显式白名单（或 `RC_GROUP_DM_CHANNELS` JSON） |
| `threadRequireMention` | boolean | `true` | 线程跟进是否需要 @bot |
| `noThreadChannels` | string[] | `[]` | 不做线程回复的 chat id |
| `replyToMode` | enum | `first` | `off` / `first` / `all` |
| `processingPlaceholder.enabled` | boolean | `false` | 处理期间发 `👀` → `⏳` 占位消息 |
| `processingPlaceholder.editDelaySeconds` | number | `2` | 占位消息编辑延迟（秒） |
| `attachments.enabled` / `maxCount` / `maxBytes` | - | `true` / `5` / `5242880` | 入站附件下载 |
| `historyMessageLimit` | number | `250` | 历史工具默认条数 |
| `homeChannel` / `homeChannelName` | string | - | 历史工具回退目标 |
| `requireMention` | boolean | `true` | Team/Everyone 全局 @bot 门控 |
| `textChunkLimit` | number | `4000` | 单条出站消息最大字符数 |
| `allowBots` | boolean | `false` | 允许 bot 身份的入站消息 |
| `provider` / `model` | string | 宿主默认 | 模型路由（优先级：per-peer 偏好 → 配置 → settings.yaml → 宿主） |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent 工作目录 |
| `sessionIdleTimeout` | number | `1800000` | 会话闲置回收（ms） |
| `showToolResults` | boolean | `false` | 展示工具调用成功结果（错误始终展示） |
| `debug` | boolean | `false` | 调试模式 |

## 内置命令

| 命令 | 说明 |
| --- | --- |
| `/new`（别名 `/reset` `/clear`） | 开始新会话（清空上下文） |
| `/compact` | 压缩会话历史（摘要替换旧记录，保留上下文） |
| `/model` | 查看或切换模型 |
| `/stop` | 中止当前生成 |
| `/rc-ping` | 连通性测试 |
| `/rc-version` | 查看版本信息 |
| `/rc-status` | 查看当前会话状态 |
| `/rc-help` | 查看所有指令 |

## 会话路由

`sessionKey: ringcentral:<accountScopeKey>:<scope>:<peerId>`，其中 scope 为
`direct`（peer = person id）、`group`（peer = Group DM chat id）、
`channel`（peer = Team/Everyone chat id）；`accountScopeKey` 为
server + bot token 的 SHA-256 指纹。SessionId 由 sessionKey 确定性派生
（SHA-256），同一用户/聊天始终路由到同一会话，重启后可按 key 恢复。
解析策略：进程内复用 → 持久化恢复 → 全新创建。

## 设计原则

- **纯 Cordis 插件** — 遵循 dsh "Plugins, not loop changes" 原则。
- **声明式依赖** — `inject = ['agents']`；tools/compaction/presets 均为可选 seam。
- **会话隔离** — 每个 RingCentral peer 一个独立 Agent。
- **Mini-Markdown 出站** — 回复转换为 RingCentral Mini-Markdown 并切分发送。
- **线程回复** — 遵循 `replyToMode`，owner 回退与去线程重试。
- **闲置回收** — 超时自动 dispose Agent，防止内存泄漏。
- **防御式降级** — 缺失 tools/presets/owner 凭据不会导致插件崩溃。

## v1 未包含（计划后续）

- Adaptive Card / note / calendar / task 工件工具
- Cron 与进程外通知发送
- 多账号支持
- 原生流式输出（RingCentral 无流式 API；处理占位消息即"正在输入"的等价物）

## 本地开发

```bash
pnpm install
pnpm build          # 或 pnpm dev（watch）
pnpm test
pnpm typecheck

# 对 npx 安装的 dsh 调试
export RC_BOT_TOKEN="xxx"
node scripts/gen-dev-patch.mjs
npx @deepseek-ai/dsh web --patch ./cordis.local.yml
```

`cordis.dev.yml` 是提交到仓库的模板；`scripts/gen-dev-patch.mjs` 把
`/path/to/dsh-ringcentral` 占位符替换为本机绝对路径，输出到已 gitignore 的
`cordis.local.yml`。

## 故障排查

| 现象 | 可能原因 | 修复 |
| --- | --- | --- |
| 插件未启动 | 缺少 `RC_BOT_TOKEN` | 设置 `RC_BOT_TOKEN` 或在 `cordis.patch.yml` 配置 `botToken` |
| Team 中 bot 不回复 | `groupPolicy: disabled` 或未 @ | 在 `teams` 中放行该 chat 并 @bot |
| 私聊被忽略 | `dmPolicy` 或配对已被占用 | 检查 `dmPolicy` / `allowFrom`；pairing 模式首个私聊用户独占配对 |
| 历史工具返回空 | 目标聊天对 owner 与 bot 均不可见 | 读取链 owner 优先、bot 回退；传裸 chat id 或 `channel:<chatId>`，并确认至少一个客户端是该聊天成员 |
| 回复未线程化 | `replyToMode: off` 或 `noThreadChannels` | 检查 `replyToMode` 与 `noThreadChannels` |
| 旧环境变量被拒绝 | `RC_ALLOWED_USER_EMAILS` 等 | 改用 `RC_ALLOW_FROM` / `RC_TEAMS`（日志中有迁移指引） |

## License

[MIT](./LICENSE)
