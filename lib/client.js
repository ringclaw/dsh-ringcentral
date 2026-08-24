// dsh-ringcentral client half — RingCentral settings card
//
// 预构建客户端 bundle（宿主按 /plugins/dsh-ringcentral/client.js 原样 serve，
// 不做转译）。工厂格式：仅 require("react")（平台静态词），其余能力全部经
// ctx 服务取得。卡片注册进 settings.plugin.item 槽，key = settings namespace
// "ringcentral"，由 dsh-client-ui-settings-plugins 的「插件配置」tab 配对渲染。
window.__ModuleLoader__.load({
  id: "dsh-ringcentral",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    var NS = "ringcentral";

    // ── 卡片内联样式（materialization 时注入一次）──
    // 视觉对齐官方 dsh-client-ui-settings-plugins 的 PluginCard / fields
    // 模块（同一组 --dsw-alias token 与尺寸；官方组件不导出，故在此复刻）。
    var CSS = [
      ".rc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
      ".rc-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
      ".rc-card.rc-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
      ".rc-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
      ".rc-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
      ".rc-head-text{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
      ".rc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
      ".rc-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
      ".rc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
      ".rc-chevron-open{transform:rotate(180deg)}",
      ".rc-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}",
      ".rc-read-only{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}",
      ".rc-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
      ".rc-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
      ".rc-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}",
      ".rc-btn-discard,.rc-btn-save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
      ".rc-btn-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:none}",
      ".rc-btn-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
      ".rc-btn-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
      ".rc-btn-discard:disabled,.rc-btn-save:disabled{opacity:.4;cursor:default}",
      ".rc-btn-discard:focus-visible,.rc-btn-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
      ".rc-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
      ".rc-field+.rc-field{border-top:1px solid var(--dsw-alias-border-l2)}",
      ".rc-field-head{align-items:center;gap:8px;display:flex}",
      ".rc-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
      ".rc-badges{align-items:center;gap:8px;display:inline-flex}",
      ".rc-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
      ".rc-badge-muted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}",
      ".rc-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:none;padding:0;font-size:12px;line-height:1.5}",
      ".rc-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
      ".rc-reset:disabled{cursor:default}",
      ".rc-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;box-sizing:border-box;width:100%}",
      ".rc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
      ".rc-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
      ".rc-input.rc-input-invalid{border-color:var(--dsw-alias-label-error)}",
      ".rc-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}",
      ".rc-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
      ".rc-bool-row{display:flex;align-items:center;gap:8px;padding:12px 0}",
      ".rc-bool-row+.rc-bool-row{border-top:1px solid var(--dsw-alias-border-l2)}",
      ".rc-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:12px 4px}"
    ].join("\n");

    // ── 字段规格（路径 → 控件类型）──
    var ENUMS = { open: 1, allowlist: 1, disabled: 1 };
    var FIELDS = [
      { path: ["access", "dmMode"], kind: "enum", options: ["open", "allowlist", "disabled"] },
      { path: ["access", "groupMode"], kind: "enum", options: ["open", "allowlist", "disabled"] },
      { path: ["access", "dmAllow"], kind: "csv", hint: "hintAllowList" },
      { path: ["access", "groupAllow"], kind: "csv", hint: "hintAllowList" },
      { path: ["requireMention"], kind: "bool" },
      { path: ["groupPrompt"], kind: "text" },
      { path: ["directPrompt"], kind: "text" },
      { path: ["processingPlaceholder", "enabled"], kind: "bool" },
      { path: ["historyMessageLimit"], kind: "number" },
      { path: ["homeChannel"], kind: "text" },
      { path: ["textChunkLimit"], kind: "number" },
      { path: ["provider"], kind: "text", placeholderKey: "phHostDefault" },
      { path: ["model"], kind: "text", placeholderKey: "phHostDefault" },
      { path: ["preset"], kind: "text", placeholderKey: "phNoPreset" },
      { path: ["cwd"], kind: "text", placeholderKey: "phCwd" },
      { path: ["sessionIdleTimeout"], kind: "number" },
      { path: ["showToolResults"], kind: "bool" },
      { path: ["debug"], kind: "bool" }
    ];
    var SECRETS = [
      { path: ["botToken"], ref: "RC_BOT_TOKEN" },
      { path: ["ownerCredentials", "clientId"], ref: "RC_USER_CLIENT_ID" },
      { path: ["ownerCredentials", "clientSecret"], ref: "RC_USER_CLIENT_SECRET" },
      { path: ["ownerCredentials", "jwt"], ref: "RC_USER_JWT_TOKEN" }
    ];

    function pathKey(path) { return path.join("."); }
    function readPath(obj, path) {
      var cur = obj;
      for (var i = 0; i < path.length; i++) {
        if (cur == null) return undefined;
        cur = cur[path[i]];
      }
      return cur;
    }
    function fieldLabel(t, path) { return t("fld." + pathKey(path)); }

    // ── 控制器：settings scope → 卡片 store ──
    // 密钥也走 settings 写入路径：部分部署（桌面端）的 credentials 域对插件
    // 不可达，而 settings 域经 inject 可用；密钥字段在 schema 中标记
    // role('secret')，wire 只回传 redacted 视图，明文永不回读。
    function RingCentralCardController(scope, api) { // NOSONAR — 必须嵌套在 ModuleLoader 工厂内（客户端 bundle 结构）
      this.scope = scope;
      this.api = api;
      this.drafts = new Map();
      this.listeners = new Set();
      this.invalidFields = new Set();
      this.saving = false;
      this.saveError = false;
      this.outer = null;

      this.unsubscribe = scope.subscribe((function () { this.publish(); }).bind(this));
      this.publish();
    }
    RingCentralCardController.prototype.getSnapshot = function () { return this.outer; };
    RingCentralCardController.prototype.subscribe = function (listener) {
      this.listeners.add(listener);
      return function () { this.listeners.delete(listener); }.bind(this);
    };
    RingCentralCardController.prototype.publish = function () {
      var scope = this.scope.getSnapshot();
      this.outer = {
        status: scope.status,
        mode: scope.mode,
        writable: scope.writable,
        revision: scope.revision,
        value: scope.value,
        base: scope.base,
        user: scope.user,
        drafts: this.drafts,
        dirty: this.drafts.size > 0,
        invalid: this.invalidFields.size > 0,
        invalidFields: this.invalidFields,
        saving: this.saving,
        saveError: this.saveError
      };
      this.listeners.forEach(function (listener) { listener(); });
    };
    RingCentralCardController.prototype.edit = function (path, value) {
      var key = pathKey(path);
      if (value === undefined || value === null || value === "") {
        this.drafts.delete(key);
      } else {
        this.drafts.set(key, value);
      }
      this.invalidFields.delete(key);
      this.saveError = false;
      this.publish();
    };
    RingCentralCardController.prototype.discard = function () {
      this.drafts.clear();
      this.invalidFields.clear();
      this.saveError = false;
      this.publish();
    };
    RingCentralCardController.prototype.resetField = function (path) {
      var self = this;
      var scope = this.scope.getSnapshot();
      this.saving = true;
      this.saveError = false;
      this.publish();
      return this.api.settings.mutate({
        ns: NS,
        ops: [{ op: "unset", path: path }],
        expectedRevision: scope.revision
      }).then(function (response) {
        if (!response || !response.result || !response.result.ok) self.saveError = true;
        self.saving = false;
        self.drafts.delete(pathKey(path));
        self.publish();
      }).catch(function () {
        self.saveError = true;
        self.saving = false;
        self.publish();
      });
    };
    // 草稿解析：每字段规格 → wire 值；失败返回 { error: true }
    RingCentralCardController.prototype.parseDraft = function (field, draft) {
      if (field.kind === "bool") return typeof draft === "boolean" ? { value: draft } : { error: true };
      if (field.kind === "number") {
        var num = Number(draft);
        return Number.isFinite(num) ? { value: num } : { error: true };
      }
      if (field.kind === "enum") return ENUMS[draft] ? { value: draft } : { error: true };
      if (field.kind === "csv") {
        var parts = String(draft).split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
        return { value: parts };
      }
      return { value: String(draft) };
    };
    RingCentralCardController.prototype.save = function () {
      var self = this;
      var scope = this.scope.getSnapshot();
      if (scope.revision === undefined) return Promise.resolve(false);

      var ops = [];
      this.invalidFields.clear();
      this.drafts.forEach(function (draft, key) {
        var field = null;
        for (var i = 0; i < FIELDS.length; i++) if (pathKey(FIELDS[i].path) === key) { field = FIELDS[i]; break; }
        var secret = null;
        for (var j = 0; j < SECRETS.length; j++) if (pathKey(SECRETS[j].path) === key) { secret = SECRETS[j]; break; }
        if (secret) {
          // 密钥走 settings 写入（credentials 域在部分部署不可达）；空草稿不写（保持已存值）
          if (typeof draft === "string" && draft.trim().length > 0) {
            ops.push({ op: "set", path: secret.path, value: draft.trim() });
          }
          return;
        }
        if (!field) return;
        var parsed = self.parseDraft(field, draft);
        if (parsed.error) { self.invalidFields.add(key); return; }
        ops.push({ op: "set", path: field.path, value: parsed.value });
      });
      if (this.invalidFields.size > 0) { this.publish(); return Promise.resolve(false); }

      this.saving = true;
      this.saveError = false;
      this.publish();

      if (ops.length === 0) {
        this.saving = false;
        this.publish();
        return Promise.resolve(!this.saveError);
      }
      return this.api.settings.mutate({
        ns: NS,
        ops: ops,
        expectedRevision: scope.revision
      }).then(function (response) {
        if (!response || !response.result || !response.result.ok) self.saveError = true;
        self.saving = false;
        self.drafts.clear();
        self.publish();
        return !self.saveError;
      }).catch(function () {
        self.saveError = true;
        self.saving = false;
        self.publish();
        return false;
      });
    };
    RingCentralCardController.prototype.inject = function () { return { hooks: {} }; };
    RingCentralCardController.prototype.dispose = function () {
      if (this.unsubscribe) this.unsubscribe();
    };

    // ── 卡片组件（闭包捕获 controller，props 只取 t）──
    function RingCentralCard(props) {
      props = props || {};
      var t = typeof props.t === "function" ? props.t : function (key) { return key; };
      var controller = props.controller;
      var snap = React.useSyncExternalStore(controller.subscribe.bind(controller), controller.getSnapshot.bind(controller));
      var open = React.useState(false);
      var isOpen = open[0];
      var setOpen = open[1];

      if (snap.status === "unavailable") {
        return React.createElement("div", { className: "rc-empty" }, t("unavailable"));
      }

      var disabled = !snap.writable;
      var blocked = !snap.dirty || snap.invalid || snap.saving;

      var renderValueControl = function (field) {
        var key = pathKey(field.path);
        var draft = snap.drafts.get(key);
        var hasDraft = snap.drafts.has(key);
        var overridden = readPath(snap.user, field.path) !== undefined;
        var invalid = snap.invalidFields.has(key);
        var value = hasDraft ? draft : readPath(snap.value, field.path);
        var fieldId = "rc-" + key.replace(/\./g, "-");

        var reset = overridden
          ? React.createElement("button", { key: "r", type: "button", className: "rc-reset", disabled: disabled, onClick: function () { controller.resetField(field.path); } }, t("reset"))
          : null;

        if (field.kind === "bool") {
          var checked = hasDraft ? !!draft : !!value;
          return React.createElement("div", { className: "rc-bool-row" }, [
            React.createElement("label", { key: "l", className: "rc-label", htmlFor: fieldId }, fieldLabel(t, field.path)),
            React.createElement("input", {
              key: "i", id: fieldId, type: "checkbox", checked: checked, disabled: disabled,
              onChange: function (event) { controller.edit(field.path, event.target.checked); }
            }),
            reset
          ]);
        }

        var textValue = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(", ") : String(value);
        var placeholder = field.placeholderKey && !hasDraft && textValue === "" ? t(field.placeholderKey) : undefined;
        var input = React.createElement(
          field.kind === "enum" ? "select" : "input",
          {
            id: fieldId,
            className: "rc-input" + (invalid ? " rc-input-invalid" : ""),
            disabled: disabled,
            value: textValue,
            ...(placeholder !== undefined ? { placeholder: placeholder } : {}),
            ...(field.kind === "number" ? { inputMode: "numeric" } : {}),
            ...(field.kind === "enum"
              ? { onChange: function (event) { controller.edit(field.path, event.target.value); }, children: field.options.map(function (option) {
                  return React.createElement("option", { key: option, value: option }, option);
                }) }
              : { onChange: function (event) { controller.edit(field.path, event.target.value); } })
          }
        );
        return React.createElement("div", { className: "rc-field" }, [
          React.createElement("div", { key: "h", className: "rc-field-head" }, [
            React.createElement("label", { key: "l", className: "rc-label", htmlFor: fieldId }, fieldLabel(t, field.path)),
            overridden
              ? React.createElement("span", { key: "b", className: "rc-badges" },
                  React.createElement("span", { className: "rc-badge" }, t("overridden")))
              : null,
            reset
          ]),
          input,
          invalid ? React.createElement("p", { key: "e", className: "rc-invalid" }, field.kind === "number" ? t("invalidNumber") : t("invalidValue")) : null,
          field.hint ? React.createElement("p", { key: "i2", className: "rc-hint" }, t(field.hint)) : null
        ]);
      };

      var renderSecretControl = function (secret) {
        var key = pathKey(secret.path);
        var draft = snap.drafts.get(key);
        // 已配置状态来自 settings user 层（wire 上密钥值被 redact，只能看覆盖标记）
        var configured = readPath(snap.user, secret.path) !== undefined;
        return React.createElement("div", { className: "rc-field" }, [
          React.createElement("div", { key: "h", className: "rc-field-head" }, [
            React.createElement("label", { key: "l", className: "rc-label" }, fieldLabel(t, secret.path)),
            React.createElement("span", { key: "s", className: "rc-badge-muted" }, configured ? t("configured") : t("notConfigured")),
            configured
              ? React.createElement("button", { key: "r", type: "button", className: "rc-reset", disabled: disabled, onClick: function () { controller.resetField(secret.path); } }, t("reset"))
              : null
          ]),
          React.createElement("input", {
            key: "i", type: "password", className: "rc-input", autoComplete: "off",
            placeholder: t("secretPlaceholder"), value: draft === undefined ? "" : String(draft),
            disabled: disabled,
            onChange: function (event) { controller.edit(secret.path, event.target.value); }
          }),
          React.createElement("p", { key: "hint", className: "rc-hint" }, t("secretHint"))
        ]);
      };

      var rows = [];
      FIELDS.forEach(function (field) { rows.push(renderValueControl(field)); });
      SECRETS.forEach(function (secret) { rows.push(renderSecretControl(secret)); });

      return React.createElement("li", { className: "rc-card" + (isOpen ? " rc-card-open" : "") }, [
        React.createElement("button", {
          key: "head", type: "button", className: "rc-header", "aria-expanded": isOpen,
          onClick: function () { setOpen(!isOpen); }
        }, [
          React.createElement("span", { key: "t", className: "rc-head-text" }, [
            React.createElement("span", { key: "n", className: "rc-name" }, t("cardTitle")),
            React.createElement("span", { key: "d", className: "rc-desc" }, t("cardDescription"))
          ]),
          snap.dirty ? React.createElement("span", { key: "u", className: "rc-pending" }, t("unsaved")) : null,
          React.createElement("span", { key: "c", className: "rc-chevron" + (isOpen ? " rc-chevron-open" : "") },
            React.createElement("svg", { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": true },
              React.createElement("path", { d: "M3 5l4 4 4-4", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" })))
        ]),
        isOpen ? React.createElement("div", { key: "body", className: "rc-body" }, [
          snap.status === "loading"
            ? React.createElement("p", { className: "rc-hint" }, t("loading"))
            : null,
          rows,
          React.createElement("div", { className: "rc-footer" }, [
            snap.saveError ? React.createElement("p", { className: "rc-failed" }, t("saveFailed")) : null,
            React.createElement("button", {
              type: "button", className: "rc-btn-discard",
              disabled: !snap.dirty || snap.saving || disabled,
              onClick: function () { controller.discard(); }
            }, t("discard")),
            React.createElement("button", {
              type: "button", className: "rc-btn-save",
              disabled: blocked || disabled,
              onClick: function () { controller.save(); }
            }, t(snap.saving ? "saving" : "save"))
          ])
        ]) : null
      ]);
    }

    // ── locale 字典 ──
    var en = {
      cardTitle: "RingCentral", cardDescription: "Team Messaging channel configuration",
      save: "Save", saving: "Saving…", discard: "Discard", unsaved: "Unsaved changes",
      reset: "Reset", overridden: "Overridden", configured: "Configured", notConfigured: "Not configured",
      unavailable: "Settings are unavailable in this browser (loopback-only).", loading: "Loading…",
      saveFailed: "Save failed — the document may have changed; your drafts were kept.", invalidNumber: "Enter a valid number.",
      invalidValue: "Invalid value.", secretPlaceholder: "Leave blank to keep the stored value",
      secretHint: "Write-only: the stored value is never sent back to this page; changes apply after a plugin restart.",
      hintAllowList: "Comma-separated ids; empty or * = allow all",
      "fld.access.dmMode": "DM access", "fld.access.groupMode": "Group access",
      "fld.access.dmAllow": "DM allowlist", "fld.access.groupAllow": "Group allowlist",
      "fld.requireMention": "Require @mention in groups", "fld.groupPrompt": "Group extra prompt",
      "fld.directPrompt": "DM extra prompt", "fld.processingPlaceholder.enabled": "Processing placeholder (👀 → ⏳)",
      "fld.historyMessageLimit": "History message limit", "fld.homeChannel": "Home channel id",
      "fld.textChunkLimit": "Max chars per post", "fld.provider": "LLM provider", "fld.model": "Model",
      "fld.preset": "Agent preset id", "fld.cwd": "Agent working directory",
      "fld.sessionIdleTimeout": "Session idle timeout (ms)", "fld.showToolResults": "Show successful tool results",
      "fld.debug": "Debug logging", "fld.botToken": "Bot JWT (RC_BOT_TOKEN)",
      "fld.ownerCredentials.clientId": "Owner client id (RC_USER_CLIENT_ID)",
      "fld.ownerCredentials.clientSecret": "Owner client secret (RC_USER_CLIENT_SECRET)",
      "fld.ownerCredentials.jwt": "Owner JWT (RC_USER_JWT_TOKEN)",
      "phHostDefault": "Blank = host default", "phNoPreset": "Blank = no preset mounted", "phCwd": "Blank = process working directory"
    };
    var zh = {
      cardTitle: "RingCentral", cardDescription: "Team Messaging 渠道配置",
      save: "保存", saving: "保存中…", discard: "放弃", unsaved: "有未保存的修改",
      reset: "重置", overridden: "已覆盖", configured: "已配置", notConfigured: "未配置",
      unavailable: "当前浏览器不支持设置写入（仅本机可用）。", loading: "加载中…",
      saveFailed: "保存失败——文档可能已被其他修改更新，草稿已保留。", invalidNumber: "请输入有效数字。",
      invalidValue: "无效值。", secretPlaceholder: "留空则保持已存值不变",
      secretHint: "只写不回读：已存密钥不会回传本页面；保存后重启插件生效。",
      hintAllowList: "逗号分隔的 id；空或 * = 全部放行",
      "fld.access.dmMode": "私聊策略", "fld.access.groupMode": "群聊策略",
      "fld.access.dmAllow": "私聊白名单", "fld.access.groupAllow": "群聊白名单",
      "fld.requireMention": "群聊需要 @bot", "fld.groupPrompt": "群聊附加提示词",
      "fld.directPrompt": "私聊附加提示词", "fld.processingPlaceholder.enabled": "处理占位消息（👀 → ⏳）",
      "fld.historyMessageLimit": "历史消息条数", "fld.homeChannel": "Home 频道 id",
      "fld.textChunkLimit": "单条消息最大字符数", "fld.provider": "LLM provider", "fld.model": "模型",
      "fld.preset": "Agent preset id", "fld.cwd": "Agent 工作目录",
      "fld.sessionIdleTimeout": "会话闲置超时（毫秒）", "fld.showToolResults": "回显成功的工具输出",
      "fld.debug": "调试日志", "fld.botToken": "Bot JWT（RC_BOT_TOKEN）",
      "fld.ownerCredentials.clientId": "Owner client id（RC_USER_CLIENT_ID）",
      "fld.ownerCredentials.clientSecret": "Owner client secret（RC_USER_CLIENT_SECRET）",
      "fld.ownerCredentials.jwt": "Owner JWT（RC_USER_JWT_TOKEN）",
      "phHostDefault": "留空 = 宿主默认", "phNoPreset": "留空 = 不挂载预设", "phCwd": "留空 = 进程工作目录"
    };

    // 注意：inject 必须是数组——客户端 loader 不解析函数形式，函数形式会被
    // 忽略（等价于空 inject），随后 ctx.settingsScope 属性访问会抛
    // "cannot get property ... without inject"。第三方插件行以兄弟身份组合，
    // 对任何以 ctx.<name> 属性访问的服务都必须显式 inject（官方包能省略是
    // 因为它们在官方组合中处于 provider 的祖先作用域）。
    var inject = ["connection", "remote", "settingsScope", "slots"];

    function apply(ctx) {
      console.log("[dsh-ringcentral] client apply start");
      var styleTag = document.querySelector('style[data-plugin-css="dsh-ringcentral/card.css"]');
      if (!styleTag) {
        styleTag = document.createElement("style");
        styleTag.dataset.plugin = "dsh-ringcentral";
        styleTag.dataset.pluginCss = "dsh-ringcentral/card.css";
        styleTag.textContent = CSS;
        document.head.appendChild(styleTag);
      }

      var connection = ctx.get("connection");
      var api = connection.api;
      var scope = ctx.settingsScope.bind({ namespace: NS });

      // ── 诊断：浏览器视角的 settings describe 视图（卡片配对判定点）──
      var describe = typeof ctx.settingsScope.describe === "function" ? ctx.settingsScope.describe() : undefined;
      var logNamespaces = function () {
        var view = describe && describe.getSnapshot ? describe.getSnapshot().view : undefined;
        console.log("[dsh-ringcentral] served namespaces:", view ? view.namespaces.map(function (n) { return n.ns; }) : "(none)");
      };
      logNamespaces();
      if (describe && typeof describe.subscribe === "function") {
        describe.subscribe(logNamespaces);
      }

      var controller = new RingCentralCardController(scope, api);

      ctx.effect(function () {
        var disposers = [];
        // ctx.get 读取可选服务：locale 未挂载时返回 undefined 而不抛错
        var locale = ctx.get("locale");
        if (locale && typeof locale.register === "function") {
          disposers.push(locale.register(NS, { en: en, zh: zh }));
        }
        return function () {
          controller.dispose();
          disposers.forEach(function (dispose) { if (typeof dispose === "function") dispose(); });
        };
      }, "dsh-ringcentral: settings card");

      var Card = function (props) {
        return React.createElement(RingCentralCard, { t: props && props.t, controller: controller });
      };

      ctx.slots.inject("settings.plugin.item", function* () {
        console.log("[dsh-ringcentral] slots inject generator running (key=" + NS + ")");
        yield ctx.slots.register({
          name: "settings.plugin.item",
          key: NS,
          locale: NS,
          inject: function () { return { hooks: {} }; }
        }, Card);
        console.log("[dsh-ringcentral] card registered into settings.plugin.item");
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
