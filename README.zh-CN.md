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
`ringcentral_get_recent_messages` 提供 owner 读取回退与出站 owner 回退。
历史工具始终优先用 bot 客户端（RC_BOT_TOKEN）读取；未配置 owner 凭据时仅用 bot 读取。

## 配置

遵循 dsh 最佳实践：**cordis 配置树是行为配置的唯一来源**（profile 的
`cordis.patch.yml` / `cordis.yml`），Schema 默认值自动生效。密钥类
（`RC_BOT_TOKEN`、`RC_USER_CLIENT_ID`、`RC_USER_CLIENT_SECRET`、
`RC_USER_JWT_TOKEN`）通过宿主 **credentials** 域解析：config 显式值优先，
其次环境变量 → 托管 `$DSH_HOME/.credentials.yaml` → 项目/用户 `.env`，最后
回退进程环境变量；密钥永不写入 profile YAML。`RC_SERVER_URL` 是运营参数，
反向前者：环境变量优先于配置默认值（便于 sandbox 覆盖）。
其余配置想用环境变量驱动时，用 cordis loader 的 `!!js` 标签（必须双
感叹号，单 `!js` 不会求值），例如
`access.groupMode: !!js process.env.RC_GROUP_MODE ?? 'open'`。

访问控制块与 `@tencent-connect/dsh-qqbot` 完全一致（QQ 的 `c2c` 表面
在这里叫 `dm`）。RingCentral 的三种非私聊聊天类型（Team / Everyone /
Group）统一归入 `group` 表面管理。

| 配置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `botToken` | string | **必填** | Bot 静态 JWT（env: `RC_BOT_TOKEN`） |
| `ownerCredentials.clientId` / `clientSecret` / `jwt` | string | - | Owner JWT（env: `RC_USER_*`） |
| `server` | string | `https://platform.ringcentral.com` | API 服务器（env: `RC_SERVER_URL`） |
| `access.dmMode` | enum | `open` | 私聊策略：`disabled` / `allowlist` / `open` |
| `access.dmAllow` | string[] | `[]` | 私聊白名单（person id）；空或含 `"*"` = 全部放行 |
| `access.groupMode` | enum | `open` | 群聊策略：`disabled` / `allowlist` / `open` |
| `access.groupAllow` | string[] | `[]` | 群聊白名单（chat id）；空或含 `"*"` = 全部放行 |
| `requireMention` | boolean | `true` | 群聊是否需要 @bot 触发 |
| `groupPrompt` | string | - | 群聊额外 system prompt |
| `directPrompt` | string | - | 私聊额外 system prompt |
| `processingPlaceholder.enabled` | boolean | `false` | 处理期间发 `👀` → `⏳` 占位消息（文本/延迟固定） |
| `historyMessageLimit` | number | `250` | 历史工具默认条数 |
| `homeChannel` | string | - | 历史工具回退目标 |
| `textChunkLimit` | number | `4000` | 单条出站消息最大字符数 |
| `provider` / `model` | string | 宿主默认 | 模型路由（优先级：per-peer 偏好 → 配置 → settings.yaml → 宿主） |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent 工作目录 |
| `sessionIdleTimeout` | number | `1800000` | 会话闲置回收（ms） |
| `showToolResults` | boolean | `false` | 展示工具调用成功结果（错误始终展示） |
| `debug` | boolean | `false` | 调试模式（含入站消息调试日志） |

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

## Agent 提问（ask_user）

agent 调用 `ask_user_question` 时，插件把问题渲染到聊天里（线程锚定）并
等待用户在同一会话中回复作答：

- 回复选项序号或选项内容选择（`multi_select` 支持 `"1, 3"` 多选），
  或直接输入自由文本答案。
- 多问题逐题作答。
- 答案用于 resolve 挂起的提问，**不会**追加进会话历史（与 web GUI 语义一致）。
- 等待超时 10 分钟自动取消并通知。

注意：provider 注册在 `userQuestions` 服务 seam 上；web profile 里 GUI
provider 优先（提问显示在网页而非 RingCentral）。纯 IM 场景请使用专用
profile。

## 设计原则

- **纯 Cordis 插件** — 遵循 dsh "Plugins, not loop changes" 原则。
- **声明式依赖** — `inject = ['agents']`；tools/compaction/presets 均为可选 seam。
- **会话隔离** — 每个 RingCentral peer 一个独立 Agent。
- **Mini-Markdown 出站** — 回复转换为 RingCentral Mini-Markdown 并切分发送。
- **线程回复** — 回复始终锚定触发消息（threadId 优先），owner 回退与去线程重试。
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

`scripts/gen-dev-patch.mjs` 直接生成已 gitignore 的 `cordis.local.yml`，
入口解析为本机绝对路径（默认 `dist/index.js`；传 `src/index.ts` 指向
TypeScript 入口）。

## 故障排查

| 现象 | 可能原因 | 修复 |
| --- | --- | --- |
| 插件未启动 | 缺少 `RC_BOT_TOKEN` | 设置 `RC_BOT_TOKEN`（环境变量或 `$DSH_HOME/.credentials.yaml`）或在 config 配置 `botToken` |
| 群聊中 bot 不回复 | `access.groupMode: disabled`、未在白名单或未 @ | 检查 `access.groupMode` / `access.groupAllow` 并 @bot |
| 私聊被忽略 | `access.dmMode: disabled` 或发送者不在 `access.dmAllow` | 检查 `access.dmMode` / `access.dmAllow` |
| 历史工具返回空 | 目标聊天对 bot 与 owner 均不可见 | 读取链 bot 优先、owner 回退；传裸 chat id 或 `channel:<chatId>`，并确认至少一个客户端是该聊天成员 |
| agent 提问在 RingCentral 收不到答复 | web profile 已注册 GUI provider | 提问显示在网页 UI；改用专用 profile 或直接在网页作答 |

## License

[MIT](./LICENSE)
