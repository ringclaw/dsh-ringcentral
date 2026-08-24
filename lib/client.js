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
    var CSS = [
      ".rc-card{border-bottom:1px solid var(--dsw-alias-border-l2)}",
      ".rc-card-head{display:flex;align-items:center;gap:8px;width:100%;background:none;border:none;padding:12px 4px;cursor:pointer;font:inherit;color:inherit;text-align:left}",
      ".rc-card-title{flex:1;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}",
      ".rc-card-desc{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}",
      ".rc-card-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500}",
      ".rc-card-body{padding:4px 4px 16px}",
      ".rc-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}",
      ".rc-field+.rc-field{border-top:1px solid var(--dsw-alias-border-l2)}",
      ".rc-field-head{display:flex;align-items:center;gap:8px}",
      ".rc-field-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
      ".rc-field-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;box-sizing:border-box;width:100%}",
      ".rc-field-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
      ".rc-field-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
      ".rc-field-input.rc-invalid{border-color:var(--dsw-alias-label-error)}",
      ".rc-bool-row{display:flex;align-items:center;gap:8px;padding:12px 0}",
      ".rc-bool-row+.rc-bool-row{border-top:1px solid var(--dsw-alias-border-l2)}",
      ".rc-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:none;padding:0;font-size:12px;line-height:1.5}",
      ".rc-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
      ".rc-reset:disabled{cursor:default;opacity:.6}",
      ".rc-status-badge{white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:11px}",
      ".rc-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
      ".rc-error{color:var(--dsw-alias-label-error);margin:0;font-size:12px}",
      ".rc-actions{display:flex;gap:8px;padding:12px 0}",
      ".rc-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;border-radius:8px;padding:6px 14px;cursor:pointer}",
      ".rc-btn:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}",
      ".rc-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-on-primary, #fff)}",
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
      { path: ["provider"], kind: "text" },
      { path: ["model"], kind: "text" },
      { path: ["preset"], kind: "text" },
      { path: ["cwd"], kind: "text" },
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

    // ── 控制器：settings scope + credentials 域 → 卡片 store ──
    function RingCentralCardController(scope, api, onCredentialUpdate) {
      this.scope = scope;
      this.api = api;
      this.drafts = new Map();
      this.listeners = new Set();
      this.invalidFields = new Set();
      this.saving = false;
      this.saveError = false;
      this.credentials = {};
      this.outer = null;

      this.unsubscribe = scope.subscribe((function () { this.publish(); }).bind(this));
      this.unsubscribeCred = typeof onCredentialUpdate === "function"
        ? onCredentialUpdate((function (ref) { this.readCredential(ref); }).bind(this))
        : undefined;
      this.publish();
      var refs = SECRETS.map(function (s) { return s.ref; });
      this.describeCredentials(refs);
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
        saving: this.saving,
        saveError: this.saveError,
        credentials: this.credentials
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
      var credentialWrites = [];
      this.invalidFields.clear();
      this.drafts.forEach(function (draft, key) {
        var field = null;
        for (var i = 0; i < FIELDS.length; i++) if (pathKey(FIELDS[i].path) === key) { field = FIELDS[i]; break; }
        var secret = null;
        for (var j = 0; j < SECRETS.length; j++) if (pathKey(SECRETS[j].path) === key) { secret = SECRETS[j]; break; }
        if (secret) {
          if (typeof draft === "string" && draft.trim().length > 0) {
            credentialWrites.push({ ref: secret.ref, value: draft.trim() });
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

      var writes = credentialWrites.map(function (w) {
        return self.api.credentials.set(w).catch(function () { self.saveError = true; });
      });
      return Promise.all(writes).then(function () {
        if (ops.length === 0) { self.saving = false; self.publish(); return !self.saveError; }
        return self.api.settings.mutate({
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
      });
    };
    RingCentralCardController.prototype.describeCredentials = function (refs) {
      var self = this;
      return this.api.credentials.describe({ refs: refs }).then(function (response) {
        if (!response || !response.result || !response.result.ok) return;
        var views = response.result.value && response.result.value.credentials;
        if (!views) return;
        refs.forEach(function (ref) {
          var view = views[ref];
          self.credentials[ref] = {
            configured: view ? !!view.configured : false,
            writable: view ? view.writable !== false : true
          };
        });
        self.publish();
      }).catch(function () {});
    };
    RingCentralCardController.prototype.readCredential = function (ref) {
      var self = this;
      if (SECRETS.every(function (s) { return s.ref !== ref; })) return;
      this.api.credentials.describe({ refs: [ref] }).then(function (response) {
        if (!response || !response.result || !response.result.ok) return;
        var view = response.result.value && response.result.value.credentials && response.result.value.credentials[ref];
        self.credentials[ref] = {
          configured: view ? !!view.configured : false,
          writable: view ? view.writable !== false : true
        };
        self.publish();
      }).catch(function () {});
    };
    RingCentralCardController.prototype.inject = function () { return { hooks: {} }; };
    RingCentralCardController.prototype.dispose = function () {
      if (this.unsubscribe) this.unsubscribe();
      if (this.unsubscribeCred) this.unsubscribeCred();
    };

    // ── 卡片组件（闭包捕获 controller，props 只取 t）──
    function RingCentralCard(props) {
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

        if (field.kind === "bool") {
          var checked = hasDraft ? !!draft : !!value;
          return React.createElement("div", { className: "rc-bool-row" }, [
            React.createElement("label", { key: "l", className: "rc-field-label", htmlFor: fieldId }, fieldLabel(t, field.path)),
            React.createElement("input", {
              key: "i", id: fieldId, type: "checkbox", checked: checked, disabled: disabled,
              onChange: function (event) { controller.edit(field.path, event.target.checked); }
            }),
            overridden
              ? React.createElement("button", { key: "r", type: "button", className: "rc-reset", disabled: disabled, onClick: function () { controller.resetField(field.path); } }, t("reset"))
              : null
          ]);
        }

        var inputType = field.kind === "number" ? "number" : "text";
        var textValue = value === undefined || value === null ? "" : Array.isArray(value) ? value.join(", ") : String(value);
        var input = React.createElement(
          field.kind === "enum" ? "select" : "input",
          {
            id: fieldId,
            className: "rc-field-input" + (invalid ? " rc-invalid" : ""),
            disabled: disabled,
            value: textValue,
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
            React.createElement("label", { key: "l", className: "rc-field-label", htmlFor: fieldId }, fieldLabel(t, field.path)),
            overridden ? React.createElement("span", { key: "o", className: "rc-badge" }, t("overridden")) : null,
            React.createElement("button", { key: "r", type: "button", className: "rc-reset", disabled: disabled || !overridden, onClick: function () { controller.resetField(field.path); } }, t("reset"))
          ]),
          input,
          invalid ? React.createElement("p", { key: "e", className: "rc-error" }, field.kind === "number" ? t("invalidNumber") : t("invalidValue")) : null,
          field.hint ? React.createElement("p", { key: "i2", className: "rc-hint" }, t(field.hint)) : null
        ]);
      };

      var renderSecretControl = function (secret) {
        var key = pathKey(secret.path);
        var draft = snap.drafts.get(key);
        var status = snap.credentials[secret.ref] || { configured: false, writable: true };
        return React.createElement("div", { className: "rc-field" }, [
          React.createElement("div", { key: "h", className: "rc-field-head" }, [
            React.createElement("label", { key: "l", className: "rc-field-label" }, fieldLabel(t, secret.path)),
            React.createElement("span", { key: "s", className: "rc-status-badge" }, status.configured ? t("configured") : t("notConfigured"))
          ]),
          React.createElement("input", {
            key: "i", type: "password", className: "rc-field-input", autoComplete: "off",
            placeholder: t("secretPlaceholder"), value: draft === undefined ? "" : String(draft),
            disabled: disabled || !status.writable,
            onChange: function (event) { controller.edit(secret.path, event.target.value); }
          }),
          React.createElement("p", { key: "hint", className: "rc-hint" }, t("secretHint"))
        ]);
      };

      var rows = [];
      FIELDS.forEach(function (field) { rows.push(renderValueControl(field)); });
      SECRETS.forEach(function (secret) { rows.push(renderSecretControl(secret)); });

      return React.createElement("div", { className: "rc-card" }, [
        React.createElement("button", {
          key: "head", type: "button", className: "rc-card-head", "aria-expanded": isOpen,
          onClick: function () { setOpen(!isOpen); }
        }, [
          React.createElement("span", { key: "t", className: "rc-card-title" }, t("cardTitle")),
          React.createElement("span", { key: "d", className: "rc-card-desc" }, t("cardDescription")),
          snap.dirty ? React.createElement("span", { key: "u", className: "rc-card-badge" }, t("unsaved")) : null,
          React.createElement("span", { key: "c", className: "rc-status-badge" }, isOpen ? "▾" : "▸")
        ]),
        isOpen ? React.createElement("div", { key: "body", className: "rc-card-body" }, [
          snap.status === "loading"
            ? React.createElement("p", { className: "rc-hint" }, t("loading"))
            : null,
          rows,
          snap.saveError ? React.createElement("p", { className: "rc-error" }, t("saveFailed")) : null,
          React.createElement("div", { className: "rc-actions" }, [
            React.createElement("button", {
              type: "button", className: "rc-btn rc-btn-primary",
              disabled: blocked || disabled,
              onClick: function () { controller.save(); }
            }, t(snap.saving ? "saving" : "save")),
            React.createElement("button", {
              type: "button", className: "rc-btn",
              disabled: !snap.dirty || snap.saving || disabled,
              onClick: function () { controller.discard(); }
            }, t("discard"))
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
      secretHint: "Write-only: the stored value is never sent to this page.",
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
      "fld.ownerCredentials.jwt": "Owner JWT (RC_USER_JWT_TOKEN)"
    };
    var zh = {
      cardTitle: "RingCentral", cardDescription: "Team Messaging 渠道配置",
      save: "保存", saving: "保存中…", discard: "放弃", unsaved: "有未保存的修改",
      reset: "重置", overridden: "已覆盖", configured: "已配置", notConfigured: "未配置",
      unavailable: "当前浏览器不支持设置写入（仅本机可用）。", loading: "加载中…",
      saveFailed: "保存失败——文档可能已被其他修改更新，草稿已保留。", invalidNumber: "请输入有效数字。",
      invalidValue: "无效值。", secretPlaceholder: "留空则保持已存值不变",
      secretHint: "只写不回读：已存密钥永远不会下发到本页面。",
      hintAllowList: "逗号分隔的 id；空或 * = 全部放行",
      "fld.access.dmMode": "私聊策略", "fld.access.groupMode": "群聊策略",
      "fld.access.dmAllow": "私聊白名单", "fld.access.groupAllow": "群聊白名单",
      "fld.requireMention": "群聊需要 @bot", "fld.groupPrompt": "群聊附加提示词",
      "fld.directPrompt": "私聊附加提示词", "fld.processingPlaceholder.enabled": "处理占位消息（👀 → ⏳）",
      "fld.historyMessageLimit": "历史消息条数", "fld.homeChannel": "Home 频道 id",
      "fld.textChunkLimit": "单条消息最大字符数", "fld.provider": "LLM provider", "fld.model": "模型",
      "fld.preset": "Agent preset id", "fld.cwd": "Agent 工作目录",
      "fld.sessionIdleTimeout": "会话闲置超时（毫秒）", "fld.showToolResults": "展示成功的工具结果",
      "fld.debug": "调试日志", "fld.botToken": "Bot JWT（RC_BOT_TOKEN）",
      "fld.ownerCredentials.clientId": "Owner client id（RC_USER_CLIENT_ID）",
      "fld.ownerCredentials.clientSecret": "Owner client secret（RC_USER_CLIENT_SECRET）",
      "fld.ownerCredentials.jwt": "Owner JWT（RC_USER_JWT_TOKEN）"
    };

    // 注意：inject 必须是数组——客户端 loader 不解析函数形式，函数形式会被
    // 忽略（等价于空 inject），随后 ctx.settingsScope 属性访问会抛
    // "cannot get property ... without inject"。第三方插件行以兄弟身份组合，
    // 对任何以 ctx.<name> 属性访问的服务都必须显式 inject（官方包能省略是
    // 因为它们在官方组合中处于 provider 的祖先作用域）。
    var inject = ["connection", "remote", "settingsScope", "slots"];

    function apply(ctx) {
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
      var controller = new RingCentralCardController(scope, api, function (listener) {
        return typeof ctx.remote.$on === "function" ? ctx.remote.$on("credentials/reference-updated", listener) : undefined;
      });

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
        yield ctx.slots.register({
          name: "settings.plugin.item",
          key: NS,
          locale: NS,
          inject: function () { return { hooks: {} }; }
        }, Card);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
