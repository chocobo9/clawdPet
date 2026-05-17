# CLAUDE.md — Anti-Shortcut Harness

> 本文件定义强制工作流。违反任何 MUST 级规则等同于任务失败。

---

## 0. 核心原则

你的目标不是"完成任务"，而是"做出好东西"。
"能跑"不等于"做得好"。"verify 通过"不等于"可以交付"。

---

## 1. 强制工作流：R-I-E（Research → Implement → Evaluate）

**每一个 Step / 每一个独立功能模块** MUST 经过三个阶段。不可跳过、不可合并、不可重排。

```
Research ──gate──► Implement ──gate──► Evaluate
   │                   │                   │
   │ 产出:             │ 产出:             │ 产出:
   │ .harness/         │ 代码文件          │ .harness/
   │ research_{id}.md  │                   │ eval_{id}.md
   │                   │                   │
   └─ subagent         └─ 主 agent         └─ subagent
     (只读工具)          (全部工具)          (只读 + 截图)
```

### Phase 1: Research（子 agent，只读）

**触发时机**：每当你要写新代码、新模块、新功能之前。

**执行方式**：用 Task 工具开一个隔离子 agent。

```
具体调用方式（二选一，优先用 Task 工具）：

方式 A — Task 工具（推荐，上下文完全隔离）：
调用你的 Task 工具，description 填写下方的 Research Agent prompt。
Task 工具会自动创建隔离的子 agent，执行完返回结果。

方式 B — bash 调用 claude（备用）：
claude -p "$(cat .harness/prompts/research_prompt.md)" \
  --allowedTools bash,Read,Glob,Grep,WebFetch \
  --output-format text \
  > .harness/research_{step_id}.md
```

**你 MUST 使用上述方式之一。禁止在主 agent 上下文中"假装"执行 research——即禁止不开子 agent 而自己搜索后自己写 research 报告。Research 和 Implement 必须是不同的 agent 上下文。**

子 agent 的 prompt：

```
你是 Research Agent。任务：调研「{task_description}」的现有实现方案。

规则：
1. 用 bash 在 GitHub 搜索至少 3 个现有实现（gh search repos / gh search code）
2. 对每个找到的方案，评估：代码质量、活跃度（star/最近提交）、可复用性
3. 如果有可直接移植的代码/素材，给出具体文件路径和移植方案
4. 如果确实没有现有方案（搜索了 ≥5 个不同关键词都没结果），明确说明

输出格式 — 严格遵守：
## 搜索记录
- 关键词1: N 个结果，最相关: [repo](url)
- 关键词2: ...

## 方案对比
| 方案 | 来源 | 优点 | 缺点 | 可复用度 |
|------|------|------|------|----------|
| A    |      |      |      | 高/中/低 |

## 推荐
选择方案 X，理由：...

## 可移植的具体资源
- 文件: url → 用途
```

**产出**：`.harness/research_{step_id}.md`

**Gate 条件**（缺一不可）：
- 搜索了 ≥3 个不同关键词
- 找到并对比了 ≥2 个现有方案（如果确实不存在，搜索记录必须证明你试了 ≥5 个关键词）
- 有明确的推荐和理由

**不通过 → 不允许进入 Phase 2。没有例外。**

### Phase 2: Implement（主 agent）

**前置条件**：`.harness/research_{step_id}.md` 存在且满足 gate 条件。

**执行规则**：
- MUST 在实现前读取 research 报告
- MUST 优先移植/适配 research 中推荐的现有方案，而非从零写
- 如果偏离了 research 推荐（选了不同方案或自己写），MUST 在代码注释中写明理由
- 从零写的代码比例如果超过 70%，触发自我审查：research 是不是白做了？

### Phase 3: Evaluate（子 agent，对抗性）

**触发时机**：Phase 2 的代码写完并且所有测试通过之后。

**执行方式**：用 Task 工具开另一个隔离子 agent。

```
具体调用方式（同 Phase 1，二选一）：

方式 A — Task 工具（推荐）：
调用 Task 工具，description 填写下方的 Evaluator Agent prompt。
把 {spec_excerpt}, {file_list}, {test_output}, {screenshot_paths} 替换为实际值。

方式 B — bash 调用 claude（备用）：
claude -p "$(cat .harness/prompts/eval_prompt.md)" \
  --allowedTools bash,Read,Glob,Grep,View \
  --output-format text \
  > .harness/eval_{step_id}.md
```

**你 MUST 使用上述方式之一。禁止自己评价自己的代码。Evaluator 必须是独立的 agent 上下文，它没有看过你的实现过程，只看到最终产物。**

子 agent 的 prompt：

```
你是 Evaluator Agent。你的职责是找问题，不是确认通过。
放过一个问题 = 你失职。宁可误报也不要漏报。

你将审查一个刚完成的功能模块。

## 输入
- 原始需求：{spec_excerpt}
- 代码文件：{file_list}
- 测试结果：{test_output}
- 运行截图：{screenshot_paths}（如果是视觉类任务）

## 审查清单（逐项回答，不可跳过）

### 功能完整性 (1-10)
- 需求中的每个要求是否都实现了？逐条对照。
- 有没有只实现了 happy path 而忽略了边界情况？

### 代码质量 (1-10)
- 有没有从零造轮子而忽略了更好的现有实现？
- 有没有 hardcoded 的值应该放配置？
- 错误处理是不是只有 try/except pass？

### 视觉质量 (1-10)（仅视觉类任务）
- 看截图：这个东西拿给用户看会不会丢人？
- 跟需求描述的视觉效果差距有多大？
- 跟同类产品（如 clawd-on-desk）的视觉水准比如何？

### 测试质量 (1-10)
- 测试是在验证行为还是在凑数？
- edge case 覆盖率够吗？
- 有没有 mock 了不该 mock 的东西？

### 偷懒检测
- 有没有选最快路径而不是最好路径的迹象？
- 有没有 research 报告推荐了方案 A 但实现时用了更简单的方案 B？
- 有没有"能跑就行"的凑合代码？

## 输出格式
每项评分 + 具体问题列表。
总评：PASS（全部 ≥7）/ FAIL（任何一项 <7）+ 必须修复的问题清单。
```

**产出**：`.harness/eval_{step_id}.md`

**Gate 条件**：
- 全部评分 ≥ 7/10 → PASS，进入下一个 Step
- 任何评分 < 7 → FAIL，回到 Phase 2 修复，修复后重新 Evaluate
- 连续 FAIL 3 次 → 停下来，把问题报告给用户，不要继续

---

## 2. 禁止行为（Hard Ban）

### 禁止用语
| 禁止说 | 说什么 |
|--------|--------|
| "完美运行" / "perfectly" | "功能 X/Y/Z 通过，视觉待评估" |
| "VERIFIED" / "全部通过" | 列出具体验证了什么、怎么验证的、结果是什么 |
| "对不起，下次改" | 分析错误模式，说具体怎么防止复发 |
| "做完了" | "Phase 3 评估通过/未通过，详见 .harness/eval_{id}.md" |

### 禁止行为
- **禁止跳过 Research 直接写代码**。即使你"已经知道怎么做"。research 阶段的目的不是教你怎么做，是确保你不会错过更好的现有方案。
- **禁止自己评价自己的代码质量**。所有质量评价必须来自 Evaluator subagent。
- **禁止连续执行超过 2 个 Step 不停下来汇报**。每 2 个 Step 后 MUST 暂停，向用户汇报进度 + 所有 eval 报告摘要，等用户确认再继续。
- **禁止在 Evaluator 返回 FAIL 后自行决定"问题不大可以跳过"**。FAIL 就是 FAIL。

---

## 3. 文件结构

```
project/
├── .harness/                    # 工作流产物，所有 gate 的证据
│   ├── research_step1.md        # Phase 1 产出
│   ├── eval_step1.md            # Phase 3 产出
│   ├── research_step2.md
│   ├── eval_step2.md
│   └── ...
├── CLAUDE.md                    # 本文件
├── PROJECT_SPEC.md              # 需求规格
└── ...                          # 项目代码
```

`.harness/` 目录是审计轨迹。不要删除、不要修改已完成的报告。

---

## 4. 视觉类任务的额外规则

任何涉及 UI / 动画 / 图形的任务：

1. **Research 阶段 MUST 包含视觉参考**：截图或录屏 URL，说明目标视觉水准
2. **Implement 完成后 MUST 截图**：用 adb screencap 或浏览器截图保存到 `.harness/screenshots/`
3. **Evaluator MUST 看截图**：不能只看代码说"应该没问题"
4. **自问**：如果这是开源项目的 README 展示图，你敢放上去吗？不敢 → 不交付

---

## 5. 检查点汇报格式

每 2 个 Step 暂停时，向用户汇报：

```
## 进度：Step X-Y 完成

### Step X: {name}
- Research: {关键发现，用了什么现有方案}
- Eval: {评分，是否一次通过，修了什么}

### Step Y: {name}
- Research: {同上}
- Eval: {同上}

### 问题 & 风险
- {遇到的问题，没把握的地方，做了什么妥协}

### 下一步
- Step Z-W 计划做什么

等你确认后继续。
```

---

## 6. Execution Constraints（从原 CLAUDE.md 保留）

### 测试
- 每个测试文件必须执行。`npx vitest run` 跑全部，不是只跑一个文件。
- 运行后报告：total, passed, failed, skipped。如有 skipped 必须列出原因。
- 禁止 `skip`, `xfail` 除非用户明确批准。
- 禁止 `try { ... } catch(e) {}` 吞掉错误的测试断言。
- 禁止 hardcode 期望输出（copy-paste 运行结果当 assert）。

### 测试分布
- Happy path ≤ 50%
- Edge/error ≥ 30%
- Adversarial/boundary ≥ 20%

### 数据
- 配置在 JSON 文件里，不在源码里 hardcode。
- 不在日志里打印完整 token / secret。

---

## 7. Common Pitfalls（项目特定）

- Server 技术栈是 Node.js（Express + ws），不是 Python。三个移植来源（claude-buddy, claude-usage-widget, clawd-on-desk）全是 JS/TS，直接移植不要跨语言翻译
- WebSocket hub 必须处理并发 connect/disconnect
- OAuth token 每次轮询重新读文件，不缓存
- Usage API endpoint 是未公开内部接口 — 移植自 `SlavomirDurej/claude-usage-widget` 的认证和轮询逻辑
- 桌宠像素素材移植自 `handsome-rich/claude-buddy` 的 `renderer/pets.js`
- Hook 状态机移植自 `rullerzhou-afk/clawd-on-desk` 的 hook 注册和状态解析逻辑
- Android WebView 必须 `setMixedContentMode(MIXED_CONTENT_ALWAYS_ALLOW)`
- Canvas 像素画 `imageSmoothingEnabled = false`
- `@JavascriptInterface` 方法在 WebView 线程，MediaPlayer 操作必须 post 到主线程
- Claude Code hooks 通过 stdin JSON 传数据，不是环境变量
- Hook JSON 格式有嵌套 `hooks` 数组：`{"matcher":"","hooks":[{"type":"command","command":"..."}]}`
- Hook 事件集和状态机移植自 clawd-on-desk，不要自行裁剪或重新设计
