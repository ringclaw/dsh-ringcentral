# 桌面端 credentials 服务不可达：诊断记录与修复结论

> 状态：已定位根因；插件侧已修复（0.3.15 文件兜底 + 0.3.17 inject 化）。
> Tauri 桌面端（danbao/dsh-desktop）无需改动。

## 症状

在桌面端（danbao/dsh-desktop 管理的 web profile）中：

- `dsh-ringcentral` 插件启动时报 `RC_BOT_TOKEN missing, plugin NOT started`（0.3.13 及更早）；
- GUI「插件配置」卡片的密钥控件与 credentials 服务相关能力表现异常。

## 证据链

| # | 证据 | 结论 |
|---|---|---|
| E1 | `dsh --profile web --dump-config`：组合树包含 `- id: credentials` 行，与 settings 相邻同层、无 disabled | 组合层声明存在 |
| E2 | 包可解析：workspace 软链 → `packages/credentials/credentials-local@0.1.1-rc.2`（master `b150a55`） | 包安装正常 |
| E3 | 用 provider 自带 `parseCredentialsDocument` 直跑真实凭据文件：解析通过；文件权限 600 | 文件合法 |
| E4 | 运行时 `ctx.get('credentials')` = undefined；同一插件内 `ctx.inject(['settings'])` 成功（settings namespace 挂载、merge 正常） | **inject 跨边界可用，ctx.get 不可见** |
| E5 | 文件含空值时该行显式失败（`failed to apply loader entry include (cordis:include): failed to apply loader entry credentials …`），说明行 init 确实执行 | 行的加载路径健康 |
| E6 | 对 credentials 行配置 `watch: false` 后服务仍不可达（探针实验） | 排除 chokidar watcher 挂起假设 |
| E7 | 插件内 `ctx.get('tools')` / `ctx.get('userQuestions')` 同样静默 undefined（历史工具与 IM 问答面注册日志从未出现） | ctx.get 对 host 服务整体不可见 |

## 根因

该 harness 的 web profile 将 profile bundle 行挂在与 host 平面隔离的作用域
（isolate）中：**bundle 行插件用 `ctx.get()` 读不到 host 平面的服务
（credentials / tools / userQuestions），而 `ctx.inject()` 是跨边界取服务的
唯一可靠路径**（settings 服务的成功注入即为对照）。这不是
`dsh-credentials-local` 的 bug，也不是桌面端 Tauri 壳的问题。

推论（待用户实测确认）：host 平面内的 apiproxy 的 `ctx.get('credentials')`
不受此隔离影响——**GUI 密钥控件的写入很可能本来就正常、会落在
`$DSH_HOME/.credentials.yaml`**。

## 修复记录（dsh-ringcentral）

| 版本 | 内容 |
|---|---|
| 0.3.15 | `resolveSecret` 增加托管凭据文件直读兜底（`$DSH_HOME/.credentials.yaml` 的 refs 映射），服务不可达时插件照常启动 |
| 0.3.17 | `installCredentialsInjection`：用 `ctx.inject(['credentials'])` 跨边界取服务，注入成功后自动优先并保持每次操作重解析；`tools` / `userQuestions` 同样 inject 化，恢复桌面端历史工具与 IM 问答面注册 |

解析链（0.3.17 起）：

```
config 显式值 → inject 注入的 credentials 服务 → ctx.get 可见服务
→ 进程环境变量 → 托管凭据文件直读
```

## 验证清单

1. 重启 app，`~/.dsh-ringcentral/debug.log` 出现：
   - `[cred] inject: credentials service …`（inject 是否命中）
   - `[tools] inject: tools registry available` + `registered ringcentral_get_recent_messages tool`（历史工具恢复）
2. GUI 10 秒测试：在卡片密钥框写入新值保存 → `cat ~/.dsh/.credentials.yaml` 观察是否更新——实测结果决定「GUI 写入闭环」是否需要上游参与。
3. 私聊发消息：bot 正常回复（0.3.15+ 已实证）。

## 遗留（可选上游沟通）

若希望 bundle 行插件的 `ctx.get` 能读 host 服务（减少第三方插件的心智负担），
可向 `deepseek-ai/deepseek-harness` 提 issue 说明该语义，或在其插件文档中
明确「bundle 行插件取 host 服务必须用 inject」。默认不自动发。
