# dsh-ringcentral

RingCentral Team Messaging IM channel plugin for
[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).
It turns a RingCentral Bot Add-in into a first-class frontend for a dsh agent:
inbound posts from RingCentral chats drive the agent loop, and assistant
replies flow back as threaded RingCentral posts.

English | [中文说明](./README.zh-CN.md)

## Architecture

```
RingCentral user ──▶ WebSocket (PostAdded) ──▶ im-ringcentral ──▶ ctx.agents ──▶ dsh agent loop ──▶ LLM
                                                │                                     │
                                                └── admission / session / event ◀────┘
                                                     (assistant reply ──▶ RingCentral post, threaded)
```

The plugin is a pure Cordis plugin following the dsh "Plugins, not loop changes"
principle. It speaks the RingCentral Team Messaging v1 REST API + WebSocket
subscription stream directly (no external SDK) and reuses the host dsh services
for agents, sessions, models, compaction, and tool presentation.

## Install

### 1. Via dsh plugin manager

```bash
# install into a profile
npx @deepseek-ai/dsh plugin --profile ringcentral add dsh-ringcentral

# start
export RC_BOT_TOKEN="your-bot-jwt"
export DEEPSEEK_API_KEY="your-deepseek-key"
npx @deepseek-ai/dsh --profile ringcentral
```

Or run the bundled installer: `sh install.sh`.

### 2. Local path

```bash
cd /path/to/dsh-ringcentral
pnpm install && pnpm build
npx @deepseek-ai/dsh plugin --profile ringcentral add /path/to/dsh-ringcentral
export RC_BOT_TOKEN="your-bot-jwt"
npx @deepseek-ai/dsh --profile ringcentral
```

### 3. --patch development mode

The `--patch` overlay loads the plugin from a local absolute path without
installing it into a profile. Generate the machine-local patch first, then
boot:

```bash
cd /path/to/dsh-ringcentral
pnpm install && pnpm build        # dist entry (npx dsh cannot resolve .js -> .ts)
node scripts/gen-dev-patch.mjs    # writes cordis.local.yml with the real path
export RC_BOT_TOKEN="your-bot-jwt"
npx @deepseek-ai/dsh web --patch ./cordis.local.yml
```

Use `pnpm dev` (tsc --watch) while iterating: the loader hot-reloads the
plugin whenever `dist/` changes. Pointing the patch at `src/index.ts` only
works inside a deepseek-harness source tree (`pnpm dsh`), not with the
`npx`-installed package.

## RingCentral bot setup

1. Sign in at <https://developers.ringcentral.com/>.
2. Create an app with the **Bot** platform type.
3. Grant at least: `TeamMessaging`, `ReadAccounts`, `WebSocketsSubscription`.
4. Install or publish the bot to your RingCentral account.
5. Copy the bot JWT and use it as `RC_BOT_TOKEN`.

Optional owner credentials (JWT REST API app for your own account, with
`TeamMessaging` + `WebSocketsSubscription` + `ReadMessages`) give
`ringcentral_get_recent_messages` owner read fallback and outbound owner
fallback. The history tool always reads through the bot client
(`RC_BOT_TOKEN`) first; without owner credentials it uses only the bot
client (chats the bot is a member of).

## Configuration

Config follows dsh practice: **the cordis config tree is the single source**
(profile `cordis.patch.yml` / `cordis.yml`), with Schema defaults applied
automatically. The plugin reads environment variables directly only for
secrets: `RC_BOT_TOKEN`, `RC_SERVER_URL`, `RC_USER_CLIENT_ID`,
`RC_USER_CLIENT_SECRET`, `RC_USER_JWT_TOKEN`. To drive any other setting
from an environment variable, use cordis `${VAR}` interpolation in your
config, e.g. `access.groupMode: ${RC_GROUP_MODE:-open}`.

The access-control block mirrors `@tencent-connect/dsh-qqbot` exactly
(QQ's `c2c` surface is `dm` here). RingCentral's three non-DM chat types
(Team / Everyone / Group) are all governed by the `group` surface.

| Config | Type | Default | Description |
| --- | --- | --- | --- |
| `botToken` | string | **required** | Bot static JWT (env: `RC_BOT_TOKEN`) |
| `ownerCredentials.clientId` / `clientSecret` / `jwt` | string | - | Owner JWT (env: `RC_USER_*`) |
| `server` | string | `https://platform.ringcentral.com` | API server (env: `RC_SERVER_URL`) |
| `botExtensionId` | string | auto-detected | Bot person id for mention/self-echo detection |
| `access.dmMode` | enum | `open` | DM handling: `disabled`, `allowlist`, `open` |
| `access.dmAllow` | string[] | `[]` | Person ids allowed in DMs; empty or `["*"]` = allow all |
| `access.groupMode` | enum | `open` | Group handling: `disabled`, `allowlist`, `open` |
| `access.groupAllow` | string[] | `[]` | Chat ids allowed in groups; empty or `["*"]` = allow all |
| `requireMention` | boolean | `true` | Require `@`-mention in group chats |
| `groupPrompt` | string | - | Extra system prompt for group chats |
| `directPrompt` | string | - | Extra system prompt for DMs |
| `processingPlaceholder.enabled` | boolean | `false` | Post `👀` → `⏳` while the agent works |
| `processingPlaceholder.editDelaySeconds` | number | `2` | Delay before `👀` becomes `⏳` |
| `attachments.enabled` / `maxCount` / `maxBytes` | - | `true` / `5` / `5242880` | Inbound attachment download |
| `historyMessageLimit` | number | `250` | Default record count for the history tool |
| `homeChannel` | string | - | Fallback target for the history tool |
| `textChunkLimit` | number | `4000` | Max chars per outgoing post |
| `allowBots` | boolean | `false` | Admit bot-authored inbound posts |
| `provider` / `model` | string | host default | LLM route (fallback chain: per-peer prefs → config → settings.yaml → host) |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent working directory |
| `sessionIdleTimeout` | number | `1800000` | Idle session eviction (ms) |
| `showToolResults` | boolean | `false` | Show successful tool results (errors always show) |
| `debug` | boolean | `false` | Debug logging (includes inbound message logs) |

## Commands

| Command | Description |
| --- | --- |
| `/new` (`/reset`, `/clear`) | Start a new session (clear context) |
| `/compact` | Compress session history (summary replaces old records) |
| `/model` | Show or switch the model |
| `/stop` | Abort the current generation |
| `/rc-ping` | Connectivity test |
| `/rc-version` | Plugin version |
| `/rc-status` | Current session status |
| `/rc-help` | List all commands |

## Session routing

`sessionKey: ringcentral:<accountScopeKey>:<scope>:<peerId>` where scope is
`direct` (peer = person id), `group` (peer = Group DM chat id), or
`channel` (peer = Team/Everyone chat id), and `accountScopeKey` is a
SHA-256 fingerprint of server + bot token. The `SessionId` is derived
deterministically (SHA-256), so the same user/chat always routes to the same
session and survives restarts. Resolution order: in-process reuse → persisted
resume → fresh create.

## Design principles

- **Pure Cordis plugin** — follows dsh "Plugins, not loop changes".
- **Declarative deps** — `inject = ['agents']`; tools/compaction/presets are optional seams.
- **Session isolation** — one agent per RingCentral peer.
- **Mini-Markdown outbound** — replies are converted to RingCentral Mini-Markdown and chunked.
- **Threading** — replies always anchor on the triggering post (threadId preferred), with owner fallback and unthreaded retry.
- **Idle eviction** — inactive agents are disposed automatically.
- **Defensive degradation** — missing tools/presets/owner credentials never crash the plugin.

## Not in v1 (planned follow-ups)

- Adaptive Card / note / calendar / task artifact tools
- Cron and out-of-process notification sender
- Multi-account support
- Native streaming (RingCentral has no stream API; the processing placeholder is the typing affordance)

## Local development

```bash
pnpm install
pnpm build          # or: pnpm dev (watch)
pnpm test
pnpm typecheck

# run against the npx-installed dsh
export RC_BOT_TOKEN="xxx"
node scripts/gen-dev-patch.mjs
npx @deepseek-ai/dsh web --patch ./cordis.local.yml
```

`cordis.dev.yml` is the committed template; `scripts/gen-dev-patch.mjs`
replaces the `/path/to/dsh-ringcentral` placeholder with the machine's
absolute path and writes the gitignored `cordis.local.yml`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Plugin not starting | `RC_BOT_TOKEN` missing | Set `RC_BOT_TOKEN` or `botToken` in `cordis.patch.yml` |
| Bot never replies in a group chat | `access.groupMode: disabled`, not allowlisted, or no mention | Check `access.groupMode` / `access.groupAllow` and `@`-mention the bot |
| DM ignored | `access.dmMode: disabled` or sender not in `access.dmAllow` | Check `access.dmMode` / `access.dmAllow` |
| History tool returns nothing | Chat not visible to bot or owner | Reads try the bot first, then the owner; pass a bare chat id or `channel:<chatId>` and make sure one client is a member |

## License

[MIT](./LICENSE)
