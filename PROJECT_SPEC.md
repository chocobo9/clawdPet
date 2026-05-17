# Clawd Phone Dashboard — 项目规格 v2

> 旧 Samsung S20 → 桌面像素桌宠 + Claude 用量监控 + 任务通知响铃器。
> 桌宠支持自定义皮肤上传，横竖屏自适应。

---

## 一、架构

```
┌──────────────────────────────────┐                   ┌───────────────────────────────┐
│  开发机 (Node.js Server)          │  LAN / Tailscale  │  旧 S20 (Android App)          │
│                                  │                    │                               │
│  ┌────────────────────┐          │     WebSocket      │  ┌─────────────────────────┐  │
│  │ UsagePoller        │──poll──► │ ◄────────────────► │  │ WebView                 │  │
│  │ 移植自              │  60s    │                    │  │  • 像素桌宠 (可换皮)     │  │
│  │ claude-usage-widget │         │                    │  │  • Session / Weekly 进度  │  │
│  └────────────────────┘         │                    │  │  • 任务状态动画          │  │
│                                  │                    │  └─────────┬───────────────┘  │
│  ┌────────────────────┐         │                    │            │ JS→Native bridge │
│  │ HookReceiver       │         │                    │  ┌─────────▼───────────────┐  │
│  │ 移植自              │◄─hook──│                    │  │ AlarmService (Kotlin)   │  │
│  │ clawd-on-desk      │         │                    │  │  • 完成 → 铃声           │  │
│  └────────────────────┘         │                    │  │  • 需确认 → 急促铃+振动  │  │
│                                  │                    │  └─────────────────────────┘  │
│  ┌────────────────────┐         │                    │                               │
│  │ SpriteManager      │ ◄──────│     HTTP Upload    │  Settings: 服务器地址 +        │
│  │ 自定义皮肤上传/管理  │         │                    │           上传自定义桌宠       │
│  └────────────────────┘         │                    │                               │
└──────────────────────────────────┘                    └───────────────────────────────┘
```

### 网络

| 方式 | 配置 | 场景 |
|------|------|------|
| 局域网 | `http://<电脑IP>:9870` | 同一 WiFi |
| Tailscale（可选） | 双方装 Tailscale，用 Tailscale IP | 跨网络 / 外出 |

Server 端不需要额外处理，用户自己决定填什么 IP。端口 9870（不与 3000/5000/8080 冲突）。

### 三个移植来源

| 模块 | 来源 | 关键文件 |
|------|------|---------|
| 桌宠像素素材 | `handsome-rich/claude-buddy` | `renderer/pets.js`（14 宠物压缩像素数据） |
| 用量监控 | `SlavomirDurej/claude-usage-widget` | 认证流程 + API 轮询 + 响应解析 |
| Hook + 状态机 | `rullerzhou-afk/clawd-on-desk` | hook 自动注册 + 状态优先级 + 多 session |

---

## 二、Server（Node.js）

### 技术选型

- **Node.js 18+**
- **Express**：HTTP 路由 + 静态文件
- **ws**：WebSocket 服务
- **node-fetch / undici**：HTTP client 轮询 Usage API
- **zod**：请求体验证
- **multer**：文件上传
- **vitest**：测试

选 Node.js 而非 Python 的理由：三个移植来源全是 JS/TS，直接移植不需要跨语言翻译。

### 目录结构

```
server/
├── src/
│   ├── index.js            # Express app 入口
│   ├── config.js           # 配置加载
│   ├── models.js           # zod schema 定义
│   ├── usage-poller.js     # 移植自 claude-usage-widget
│   ├── hook-receiver.js    # 移植自 clawd-on-desk
│   ├── websocket-hub.js    # WebSocket 连接管理 + 广播
│   └── sprite-manager.js   # 皮肤管理 + 上传
├── static/                 # 前端文件
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── pet.js
│   └── alarm.js
├── skins/                  # 桌宠皮肤
│   └── default/
│       ├── manifest.json
│       └── *.gif
├── tests/
│   ├── usage-poller.test.js
│   ├── hook-receiver.test.js
│   ├── websocket-hub.test.js
│   ├── sprite-manager.test.js
│   └── models.test.js
├── package.json
└── README.md
```

### 配置 (`config.js`)

从 `~/.clawd-phone/config.json` 加载，首次运行自动创建默认值：

```json
{
  "claudeCredentialsPath": "~/.claude/.credentials.json",
  "pollIntervalSeconds": 60,
  "host": "0.0.0.0",
  "port": 9870,
  "hookSecret": ""
}
```

### UsagePoller (`usage-poller.js`)

**MUST 移植自 `SlavomirDurej/claude-usage-widget`。**

Research 阶段 fetch 该仓库的认证 + API 轮询代码，理解：
- 如何读取/刷新 OAuth token（`~/.claude/.credentials.json`）
- 完整 API endpoint URL + headers + 请求格式
- 如何从 response 提取 session_percent / weekly_percent / resets_at

推送数据模型：

**字段名和结构 MUST 匹配 claude-usage-widget 的实际 API 响应解析结果。** 不要预设字段名。Research 阶段 fetch 该仓库的响应解析代码后确定 schema。

核心需要的数据点（字段名待 research 确认）：
- 当前 session 已用百分比
- session 重置时间（ISO 8601，客户端倒计时）
- weekly 已用百分比
- weekly 重置时间
- 套餐名称
- 最后更新时间

**错误处理**：
- Token 不存在/过期 → 广播 error 事件，不崩溃，下次重试
- 网络错误 → 指数退避（60s → 120s → 240s → 上限 300s），恢复后回正常间隔
- Token 每次轮询从文件重新读取，不缓存（Claude Code 可能运行期间刷新 token）
- 日志不打印完整 token，只打印前 8 字符

### HookReceiver (`hook-receiver.js`)

**MUST 移植自 `rullerzhou-afk/clawd-on-desk`。**

Research 阶段 fetch 该仓库的：
- Hook 自动注册逻辑（如何修改 `~/.claude/settings.json`）
- 状态机（hook 事件 → 桌宠状态映射）
- 多 session 状态合并（取最高优先级）

接口：`POST /api/hook`

**事件模型 MUST 移植自 clawd-on-desk 的 hook 事件定义。** 不要自行定义 event 枚举。Research 阶段 fetch clawd-on-desk 的 hook receiver 代码，理解其完整的事件类型和处理逻辑，在实现时保持兼容。

安全：`hookSecret` 非空时检查 `Authorization: Bearer <secret>`；拒绝 >1MB 请求体。

### WebSocketHub (`websocket-hub.js`)

- 路由：`ws://host:9870/ws`
- 连接时立即推送最近一次 `usage_update`
- 广播消息类型：`usage_update` / `task_event` / `error`
- 心跳：30 秒 ping/pong
- 断连清理：不阻塞其他连接

### SpriteManager (`sprite-manager.js`)

管理桌宠皮肤：内置默认 + 用户自定义上传。

**皮肤结构**：
```
skins/
├── default/              # 默认皮肤（移植自 claude-buddy）
│   ├── manifest.json
│   └── *.gif             # 每个状态一个 gif，状态名与 clawd-on-desk 状态机对齐
└── custom/               # 用户上传（缺失状态 fallback 到 default）
    ├── manifest.json
    └── ...
```

状态文件名对应桌宠状态机的每个状态（从 clawd-on-desk 移植，不要预设）。

**manifest.json**：

**格式 MUST 兼容 claude-buddy 的 `pets.js` 数据结构。** Research 阶段 fetch `claude-buddy` 的 `renderer/pets.js`，理解其像素数据的压缩格式、帧组织方式和状态命名，manifest 格式据此设计。具体的帧数、spriteSize 等参数不要预设，从 claude-buddy 的实际数据推导。

**API**：
```
GET  /api/skins                     → 列出所有皮肤
GET  /api/skins/active              → 当前激活皮肤名
PUT  /api/skins/active              → 切换皮肤
POST /api/skins/upload              → 上传皮肤（zip 或单个 gif/png）
GET  /api/skins/:name/:state.gif    → 获取特定状态动画
```

**上传规则**：
- 支持 zip（含 manifest + 动画文件）或逐个上传（`?skin=xxx&state=idle`）
- 校验：格式合法（gif/png/webp）、尺寸 16-128px、单文件 ≤ 2MB、zip ≤ 10MB
- 缺失状态 fallback 到 default
- 文件名 sanitize，防路径穿越

---

## 三、Android App（Kotlin）

### 技术选型

- **Kotlin** + Android View system（不用 Compose）
- **WebView** 渲染桌宠 + 用量 UI
- **MediaPlayer / RingtoneManager** 播放铃声
- **Vibrator** 振动
- **minSdk 29**，**targetSdk 34**

### 权限

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
```

### 模块

```
android/app/src/main/java/com/clawd/phone/
├── MainActivity.kt        # 全屏沉浸 WebView
├── AlarmBridge.kt          # JS↔Native 铃声/振动
├── KeepAliveService.kt     # 前台 Service 保活
└── SettingsActivity.kt     # 服务器地址 + 皮肤管理
```

**MainActivity**：全屏沉浸模式，`FLAG_KEEP_SCREEN_ON`，WebView 启用 JS + DOM Storage + `MIXED_CONTENT_ALWAYS_ALLOW`。首次无地址 → 跳 Settings。长按返回键打开设置。

**AlarmBridge**：
```kotlin
class AlarmBridge(private val context: Context, private val handler: Handler) {
    // @JavascriptInterface 方法在 WebView 线程，所有操作 post 到主线程

    @JavascriptInterface
    fun playAlarm(type: String)
    // type 对应桌宠状态机中需要提醒用户的状态
    // 铃声和振动模式 MUST 在 Research 阶段参考 clawd-on-desk 的音效设计（含 cooldown 机制）
    // 未知 type → 忽略不崩溃

    @JavascriptInterface
    fun stopAlarm()

    @JavascriptInterface
    fun setVolume(percent: Int)  // clamp 0-100
}
```

铃声 fallback：找不到自定义铃声 → `RingtoneManager.TYPE_NOTIFICATION` / `TYPE_ALARM`。

**KeepAliveService**：前台 Service + 常驻通知 "Clawd is watching"。

**SettingsActivity**：服务器 URL 输入 + Test Connection 按钮 + 皮肤管理（预览 6 状态缩略图、上传、切换）。

---

## 四、Web 前端（`server/static/`）

### 自适应布局

CSS Grid + `@media (orientation: landscape)` 切换。

**结构约束**（这些是功能性的，不可变）：
- 三个区域：桌宠动画、用量数据、状态栏
- 竖屏：桌宠在上，用量在中，状态栏在下
- 横屏：桌宠在左，用量+状态栏在右

**视觉风格**：Research 阶段参考 `claude-buddy` 和 `claude-usage-widget` 的前端设计，在 research 报告中给出视觉方案推荐。唯一硬约束是深色背景（常亮不刺眼）。

### 桌宠动画 (`pet.js`)

**默认皮肤**：移植自 `handsome-rich/claude-buddy` 的 `renderer/pets.js`。

**状态机**：

**MUST 移植自 clawd-on-desk 的状态定义和优先级系统。** clawd-on-desk 有 12 个状态，不要自行裁剪。Research 阶段 fetch 其状态机代码，在 research 报告中列出所有状态和对应的 hook 事件映射，然后完整移植。

**皮肤加载**：
1. `GET /api/skins/active` → 获取当前皮肤名
2. 对 6 个状态加载 `GET /api/skins/{name}/{state}.gif`
3. 支持三种格式：GIF（用 gifuct-js 解帧）、PNG sprite sheet（drawImage 裁切）、JSON 帧数据（claude-buddy 兼容）
4. 加载失败 → fallback default

**Canvas**：`imageSmoothingEnabled = false`，自适应缩放保持宽高比。

**PetEngine 接口**：`setState(state)`, `render()`, `start()`, `stop()`, `loadSkin(name)`

### 用量进度条

**MUST 在 Research 阶段参考以下现有前端实现，选择最适合移动端竖屏/横屏的方案移植或适配：**
- `SlavomirDurej/claude-usage-widget` → `src/renderer/`（进度条、倒计时环、深色主题、趋势图）
- `handsome-rich/claude-buddy` → `renderer/`（index.html + style.css + app.js，Dynamic Island 风格）

不要在 spec 里预设配色和样式参数。Research Agent 对比两个方案后在 research 报告中推荐视觉方案，Implementation Agent 据此实现。

唯一的硬约束：
- 深色背景（手机桌面设备常亮不刺眼）
- 进度条数据来自 WebSocket `usage_update`
- `sessionResetsAt` 客户端 JS 实时倒计时
- CSS transition 平滑动画

### WebSocket 客户端 (`app.js`)

- 断连指数退避重连（1s → 2s → 4s → ... → 30s），UI 显示 "🔴 Reconnecting..."
- `window.Android` 不存在时 fallback console.log
- 收到 `task_event` → 更新桌宠状态 + 调用 `window.Android.playAlarm(type)`

---

## 五、Hook 集成

**MUST 移植自 clawd-on-desk 的 hook 注册和状态机逻辑。**

### Hook 安装脚本 (`scripts/install-hooks.js`)

Node.js 脚本，运行一次：
- 自动检测本机 IP
- 读取现有 `~/.claude/settings.json`，合并（不覆盖）hook 配置
- 支持 `--uninstall` 移除

Hook 事件 → server：
**MUST 移植 clawd-on-desk 的完整 hook 事件集（SessionStart / PreToolUse / PostToolUse / Stop / Notification 等）。** 不要自行裁剪事件类型。clawd-on-desk 用这些事件驱动 12 状态的状态机，裁剪事件会导致状态机残缺。

Hook JSON 格式（嵌套 `hooks` 数组，注意内层结构）：
```json
{
  "hooks": {
    "<EventName>": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/notify.js <event>" }] }]
  }
}
```
具体注册哪些事件、每个事件传什么参数，移植 clawd-on-desk 的 hook 自动注册逻辑。

### 通知脚本 (`scripts/notify.js`)

```javascript
// Claude Code hooks 通过 stdin 传 JSON（含 session_id, cwd 等）
// 读 stdin → 解析 → POST 到 server /api/hook
```

---

## 六、测试

### Server 测试（vitest）

**usage-poller.test.js**（~10 cases）：
正常解析、token 缺失/过期/JSON 损坏、API 401/429/500、网络超时、退避恢复、token 运行期刷新

**hook-receiver.test.js**（~9 cases）：
合法事件、未知 event 类型、缺字段、请求体过大、hook_secret 验证（有/无/错误）

**websocket-hub.test.js**（~5 cases）：
连接即推送最近 usage、广播、断连不影响其他、ping/pong、无连接广播不报错

**sprite-manager.test.js**（~9 cases）：
列出皮肤含 default、上传合法 zip、超大文件 413、非法格式 400、获取状态文件、缺失状态 fallback、切换皮肤、路径穿越攻击、同名覆盖

**models.test.js**（~4 cases）：
UsageData 字段范围、TaskEvent 枚举、timestamp 格式、边界值（0/100/负数）

**分布要求**：happy path ≤50%、edge/error ≥30%、adversarial ≥20%

### Android 测试

**单元（JUnit）**：AlarmBridge 各 type 测试、未知 type 不崩溃、stopAlarm 无铃声不崩溃、setVolume clamp

**仪器（Espresso）**：MainActivity 启动 WebView 可见、无地址跳 Settings、Settings 保存后返回

### 前端测试

- `pet.js` 状态机逻辑在 Node.js 环境测试（vitest）
- `app.js` WebSocket 重连逻辑 mock 测试
- 视觉测试：截图保存到 `.harness/screenshots/`，Evaluator 审查

---

## 七、实现步骤

### Step 1: 脚手架
创建 monorepo：`server/`、`android/`、`scripts/`、`.harness/`、`CLAUDE.md`、`package.json`。
**verify**: `ls` 确认结构；`npm install` 无报错。

### Step 2: 数据模型 + 配置
`config.js` + `models.js`（zod schema）。
**verify**: `npx vitest run models.test.js` 通过。

### Step 3: WebSocket Hub
**verify**: `npx vitest run websocket-hub.test.js` 通过，含连接/断连/广播/心跳。

### Step 4: Hook Receiver
**verify**: `npx vitest run hook-receiver.test.js` 通过；`curl POST /api/hook` 合法/非法事件返回正确状态码。

### Step 5: Usage Poller
**verify**: `npx vitest run usage-poller.test.js` 通过；特别验证 token 缺失不崩溃、退避逻辑。

### Step 6: Sprite Manager + Server 集成
`sprite-manager.js` + Express 主入口 + 静态文件挂载。
**verify**: `npx vitest run` 全部通过；`node src/index.js` 启动无报错；`curl /api/skins` 返回含 default；`curl /api/health` 200。

### Step 7: 桌宠动画 + 自定义皮肤
移植 claude-buddy 像素数据 → 默认皮肤；实现 GIF/PNG/JSON 加载器；皮肤切换。
**verify**: 浏览器看到默认桌宠；6 状态 `petEngine.setState()` 都能切换；上传自定义 GIF 后切换皮肤渲染正确。截图保存 `.harness/screenshots/`。

### Step 8: 用量 UI + 横竖屏
进度条 + WebSocket 客户端 + alarm 桥接 + 横竖屏自适应。
**verify**: 竖屏横屏布局都正确（Chrome DevTools 截图）；`curl POST /api/hook` 后桌宠状态切换。

### Step 9: Android 基础框架
`MainActivity` + `SettingsActivity` + `KeepAliveService`。
**verify**: `./gradlew assembleDebug` 编译成功；模拟器首次启动弹设置页。

### Step 10: WebView + AlarmBridge + 皮肤上传
**verify**: `./gradlew test` 通过；模拟器/真机 WebView 加载正常；`window.Android.playAlarm('task_complete')` 有声音。

### Step 11: Hook 脚本 + 自动注册
**verify**: `node scripts/notify.js task_complete` → server 收到事件 → 手机桌宠切换 celebrate + 响铃。

### Step 12: E2E
全链路：Claude Code hook → server → WebSocket → 手机桌宠 + 铃声。
**verify**: 完整 E2E，记录在 TESTING.md。

### Step 13: README + 文档
**verify**: README 含项目简介、架构图、安装步骤（可复制执行的命令）、配置说明、FAQ ≥3 个。

---

## 八、ASSUMES

> 最不确定的点：(1) Usage API 的获取方式 (2) Claude Code hook stdin JSON 的具体字段名

- ASSUMES: OAuth token 在 `~/.claude/.credentials.json` — EVIDENCE: 多个社区项目确认
- ASSUMES: 存在 OAuth token 可访问的用量 endpoint — **这是未公开内部 API**。MUST 移植 `claude-usage-widget` 的实现，不要猜。如不可行，fallback 解析 `~/.claude/projects/` 下的 JSONL 日志
- ASSUMES: Hook stdin JSON 含 `session_id` — EVIDENCE: 官方文档。但字段名可能是 camelCase。**实现时先打印实际 JSON 确认**
- ASSUMES: S20 运行 Android 10+
- ASSUMES: 手机和电脑同一局域网（或通过 Tailscale）
