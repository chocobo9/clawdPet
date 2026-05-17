# UI 改版设计稿

> 基于横屏优先的桌面监控 dashboard 重做前端布局和视觉风格。

## 视觉风格

- 深色背景 `#0f1023`，加微弱暖色 radial-gradient（左下橙色、右上紫色，opacity 6-8%）
- 渐变进度条：session 用橙色渐变 `#f59e0b → #ef6c00`，weekly Opus 用紫色渐变 `#818cf8 → #6366f1`，weekly Sonnet 用蓝色渐变 `#38bdf8 → #0ea5e9`
- 无卡片边框，无分区线，信息直接浮在背景上
- 字体大且易读：百分比数字 16-20px 加粗，时钟 32px，标签 13-15px
- 所有浮层/下拉框背景 `#1a1a2e`，圆角 10-16px，0.5px 白色 12% opacity 边框

## 横屏布局（主要使用方式）

```
┌──────────────────────────────────────────────────────────────┐
│ 🟢 Connected · Makima                  [session: clawdPet ▼] │
├──────────────────────┬───────────────────────────────────────┤
│                      │  Session                     2h 18m  │
│    💬 对话气泡        │  ████████████░░░░░░░░░         79%   │
│    (当前任务状态)     │                                      │
│                      │  Weekly                      4d 13h  │
│    🐣 桌宠            │  Opus   ████░░░░░░░░░░░        23%  │
│    (点击打开皮肤选择)  │  Sonnet █░░░░░░░░░░░░░░         1%  │
│                      │                                      │
├──────────────────────┴───────────────────────────────────────┤
│ 20:30  2026.05.17 Sun                      Updated 2m ago   │
└──────────────────────────────────────────────────────────────┘
```

CSS Grid: `grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr auto;`
顶栏和底栏 `grid-column: 1 / -1` 跨满。

## 竖屏布局

```
┌──────────────────────┐
│ 🟢 Connected · Makima│
│         [clawdPet ▼] │
├──────────────────────┤
│                      │
│    💬 对话气泡        │
│    🐣 桌宠 (居中)     │
│                      │
├──────────────────────┤
│ Session       2h 18m │
│ ████████░░░░    79%  │
│ Weekly        4d 13h │
│ Opus ███░░░     23%  │
│ Sonnet █░░░      1%  │
├──────────────────────┤
│ 20:30  05.17 Sun     │
│          Updated 2m  │
└──────────────────────┘
```

用 `@media (orientation: landscape)` 和 `@media (orientation: portrait)` 切换。

## 交互组件

### 1. Session 选择器（右上角胶囊）

- 默认显示当前 session 名 + 状态色点 + ▼
- 点击展开下拉列表，每项显示：色点 + 项目名 + 当前任务 + 状态文字
- 色点颜色：working = `#f59e0b`，alert = `#ef4444`，idle = `#6b7280`，celebrate = `#22c55e`
- 切换 session 只更新：胶囊名字、气泡内容、桌宠动画状态
- 不更新：session 用量、weekly 用量（这些是账户级别的）
- 点击外部区域关闭下拉

### 2. 皮肤选择器（点击桌宠触发）

- 点击桌宠区域 → 弹出全屏半透明遮罩 `rgba(0,0,0,0.6)` + 居中面板
- 面板标题 "Choose pet" + 关闭 ×
- 内容：横排 flex wrap 的皮肤缩略图格子（56×56px，圆角 10px）
- 当前选中的有橙色边框 `2px solid #f59e0b`，其余 `2px solid transparent`
- 最后一个格子是上传按钮：虚线边框 + 居中 "+" 号
- 点击皮肤 → 切换桌宠 → 关闭浮层
- 点击上传 → 调用 `/api/skins/upload`（通过 Android 文件选择器或 WebView input[type=file]）
- 点击遮罩或 × 关闭

### 3. 对话气泡

- 半透明白色背景 `rgba(255,255,255,0.1)`，圆角 16px
- 底部有三角形指示器指向桌宠
- 内容来自 WebSocket 的 task_event 消息
- 不同状态示例：
  - working: "Running vitest..."
  - thinking: "Analyzing code..."
  - alert: "Needs approval!"
  - celebrate: "Task complete!"
  - idle: "Watching..."
  - sleeping: "ZZZ..."

## 底栏

- 左侧：时钟 32px 粗体 + 日期 13px 灰色
- 右侧："Updated Xm ago" 13px 灰色
- 时钟用 JS `setInterval` 每秒更新

## 数据映射

| UI 元素 | 数据来源 | 更新频率 |
|---------|---------|---------|
| 连接状态 | WebSocket 连接状态 | 实时 |
| 用户名 "Makima" | 配置文件 | 启动时 |
| Session 胶囊 | WebSocket `task_event` 的 session 列表 | 实时 |
| 对话气泡 | 当前选中 session 的最新 task_event.message | 实时 |
| 桌宠动画状态 | 当前选中 session 的 state | 实时 |
| Session 用量 | WebSocket `usage_update` | 每 60s |
| Weekly 用量 | WebSocket `usage_update` | 每 60s |
| 时钟 | 客户端 JS | 每秒 |
| "Updated Xm ago" | 最后一次 `usage_update` 的时间戳 | 每秒（客户端计算） |

## 实现注意

- 这是对现有 `server/static/` 下前端文件的重写，不涉及 server 或 Android 改动
- 保持现有的 WebSocket 消息格式兼容
- 桌宠 Canvas 渲染逻辑（pet.js）不变，只改外层布局和样式
- 进度条宽度用 CSS `width: ${percent}%` 绑定，加 `transition: width 0.5s ease`
