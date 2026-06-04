# PI Agent 开发知识手册

本文档用于指导后续基于 `pi` 开发自己的 agent。它不是临时读码笔记，而是后续开发时可以直接引用的架构手册、边界说明和实施路线。

## 结论

按“能自己做 pi agent”的目标，必须掌握的主干已经完整覆盖：

- `packages/ai`：模型、provider、stream、跨 provider 消息转换、工具参数校验。
- `packages/agent`：低层 agent loop、工具执行、队列、事件、取消、上下文转换。
- `packages/coding-agent`：CLI/SDK/runtime/session、资源系统、扩展系统、工具定义、RPC/print/interactive 模式。
- 自研入口：优先 extension，其次 SDK runtime，需要跨语言时用 RPC，只有要改 TUI 或底层调度时才 fork。

不需要在常规自研 agent 阶段逐行掌握的部分：

- TUI 组件的视觉细节。
- 主题渲染和布局细节。
- 每个 provider 的全部边缘兼容分支。
- 导出 HTML、OAuth UI、session selector 等外围功能细节。

## 总体心智模型

Pi 的核心不是一个单文件 agent，而是四层组合：

```text
应用外壳层
  CLI / interactive / print / rpc / 自定义 SDK 外壳

coding-agent 业务层
  AgentSession / Runtime / SessionManager / ResourceLoader / Extensions / Tools

agent 核心循环层
  Agent / agentLoop / tool execution / queues / events / cancellation

ai provider 层
  Model / streamSimple / provider registry / message transform / validation
```

开发自己的 pi agent 时，原则是：

- 尽量复用 `AgentSession`，不要绕过它直接调用低层 `agentLoop`。
- 尽量通过 extension 改行为，不直接改内置工具或底层 loop。
- 尽量通过 SDK runtime 做自己的产品外壳，不 fork CLI。
- 只有当现有 extension/SDK/RPC 都无法表达目标时，才考虑改源码。

## 包结构地图

| 包 | 角色 | 关键文件 |
| --- | --- | --- |
| `packages/ai` | provider 和模型抽象 | `src/stream.ts`, `src/api-registry.ts`, `src/providers/transform-messages.ts`, `src/utils/validation.ts`, `src/types.ts` |
| `packages/agent` | 低层 agent loop | `src/agent.ts`, `src/agent-loop.ts`, `src/types.ts` |
| `packages/coding-agent` | 完整 coding agent 产品层 | `src/core/sdk.ts`, `src/core/agent-session.ts`, `src/core/agent-session-services.ts`, `src/core/agent-session-runtime.ts` |
| `packages/tui` | 终端 UI 基础组件 | TUI 渲染、输入、组件能力 |

## PI WEB 内置 Web 模式

`pi-web` 的正确定位不是 LLM tool，也不是普通 extension，而是 Pi 的 Web 使用模式。

核心分层：

- Web/API 进程：负责 HTTP/WebSocket、workspace/git/file/terminal/session proxy 和静态前端。
- Session daemon：长期持有 `AgentSessionRuntime`，浏览器断开或 Web/API 重启不应中断 session。
- Service manager CLI：负责安装、启动、停止、重启、状态、日志和诊断。
- 浏览器插件系统：运行在 Web UI 内，不等于 Pi extension runtime。

接入原则：

- 用户入口应是 `pi web ...`，例如 `pi web install`、`pi web status`、`pi web logs`、`pi web doctor`。
- `install`、`restart`、`uninstall` 属于有副作用的用户命令，不应暴露成模型可自动调用的默认 tool。
- Web 源码属于 `packages/coding-agent/web`，是 `pi` 的内部 Web mode，不再作为独立 workspace/package 发布。
- 主 `pi` CLI 通过 `pi web ...` 路由到内置 Web mode；最终安装产物必须随 `packages/coding-agent/dist/web` 一起发布。
- 服务文件应优先指向 bundled entrypoint；不能依赖用户 shell 的全局 `pi-web` bin 一定存在。
- `node-pty` 是 Web terminal 的必要 native 依赖，引入时必须明确纳入 shrinkwrap lifecycle allowlist 并说明原因。

维护边界：

- `packages/coding-agent/web/src/client` 是浏览器/Vite/Lit 代码，由 `packages/coding-agent/web` 内部 tsconfig 管理，不放进 root Node strip-only 检查。
- `packages/coding-agent/web/src/server/sessiond.ts` 和 session runtime ownership 变更需要手动重启 `pi-web-sessiond.service`。
- OAuth callback 类型跟随 `packages/ai` 演进；新增 callback 时 Web flow state 必须同步展示或记录必要交互信息。
- Web mode 的状态页推荐命令应使用 `pi web ...`，不要重新引入独立 `pi-web` bin 或 npm 包语义。

## 关键公开入口

优先从包根导入，不要直接依赖 `src/*` 内部路径：

```ts
import {
  createAgentSession,
  createAgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createReadToolDefinition,
  createBashToolDefinition,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
```

重要公开入口：

| 入口 | 用途 |
| --- | --- |
| `createAgentSession()` | 最简单的 SDK 会话创建入口 |
| `createAgentSessionServices()` | 创建 cwd-bound services：settings、resource loader、model registry、auth 等 |
| `createAgentSessionFromServices()` | 基于已有 services 创建 `AgentSession` |
| `createAgentSessionRuntime()` | 管理可切换 session 的 runtime，适合产品外壳 |
| `runPrintMode()` | 复用 print 模式 |
| `runRpcMode()` / `RpcClient` | 复用 JSONL RPC 模式 |
| `create*ToolDefinition()` | 复用内置工具定义或改 operations |
| `ExtensionFactory` | 写扩展的主要类型 |

## `packages/ai` 层

### 责任

`packages/ai` 负责把统一的 Pi 消息和工具抽象适配到不同 provider。

它处理：

- `Model` 定义。
- `streamSimple(model, context, options)` provider 分发。
- provider registry。
- tool schema 转换。
- tool call id 规范化。
- thinking/reasoning 兼容。
- 图片和 tool result 兼容。
- provider 错误和流事件协议。

### 关键文件

| 文件 | 作用 |
| --- | --- |
| `packages/ai/src/types.ts` | `Model`, `Message`, `Tool`, `Context`, stream event 协议 |
| `packages/ai/src/stream.ts` | `stream()` / `streamSimple()` 主入口 |
| `packages/ai/src/api-registry.ts` | 自定义 API provider 注册 |
| `packages/ai/src/providers/transform-messages.ts` | 跨 provider 消息转换 |
| `packages/ai/src/utils/validation.ts` | tool arguments 校验和转换 |

### Provider 分发

`streamSimple(model, context, options)` 根据 `model.api` 找到 provider 实现。

所以新增 provider 的关键不是只新增 provider 名，而是注册该 provider 对应的 API stream handler。

核心关系：

```text
Model.provider = 供应商身份
Model.id       = 模型 ID
Model.api      = 请求协议/stream 实现选择键
```

示例：

```text
provider: "my-proxy"
id: "claude-sonnet-4-5-proxy"
api: "anthropic-messages"
```

如果复用已有 API 协议，可以只注册模型和 base URL。  
如果是新协议，必须注册 `streamSimple` 实现。

### 不要绕过 message transform

不要为了省事手拼 provider 请求体。`transformMessages()` 里有很多跨 provider 兼容逻辑：

- 图片降级。
- thinking block 转换。
- tool call id 规范化。
- tool result 与 assistant tool call 对齐。
- orphan tool result 处理。
- aborted/error assistant replay 处理。
- provider 不支持字段的剔除。

绕过这一层会导致某些 provider 在恢复会话、重放工具调用、切模型后失败。

### Tool 参数校验

工具参数校验发生在 `packages/ai/src/utils/validation.ts`。

实际顺序：

```text
LLM toolCall.arguments
  -> tool.prepareArguments(args)
  -> validateToolArguments(tool, preparedToolCall)
  -> Value.Convert / JSON Schema coercion
  -> validator.Check
  -> tool.execute(validatedArgs)
```

注意：

- `prepareArguments` 可以把旧格式参数迁移到新 schema。
- `tool_call` extension handler 收到的是已校验对象。
- `tool_call` handler 可以原地修改 `event.input`。
- 修改后不会二次校验。
- 因此权限扩展或参数修正扩展不要塞入不符合 schema 的值。

## `packages/agent` 层

### 责任

`packages/agent` 是低层运行时，负责：

- 管理 agent state。
- 启动 LLM stream。
- 处理 assistant message。
- 执行 tool calls。
- 维护 steering/follow-up 队列。
- 发出生命周期事件。
- 处理 abort。

### 关键文件

| 文件 | 作用 |
| --- | --- |
| `packages/agent/src/agent.ts` | `Agent` 类，状态、队列、事件订阅、prompt/continue |
| `packages/agent/src/agent-loop.ts` | 真正的循环：LLM 调用、工具执行、队列注入 |
| `packages/agent/src/types.ts` | agent message、tool、hook、事件类型 |

### Agent 状态

`Agent` 的核心状态包含：

- `systemPrompt`
- `model`
- `thinkingLevel`
- `tools`
- `messages`
- `isStreaming`
- `streamingMessage`
- `pendingToolCalls`
- `errorMessage`

状态数组赋值会复制顶层数组，避免外部直接持有内部数组引用。

### Agent loop 流程

简化流程：

```text
agent.prompt(user messages)
  -> runAgentLoop()
  -> emit agent_start / turn_start / message_start / message_end
  -> transformContext(messages)
  -> convertToLlm(messages)
  -> streamSimple(model, context, options)
  -> assistant message
  -> 如果有 tool calls，执行工具
  -> 写入 toolResult messages
  -> emit turn_end
  -> prepareNextTurn()
  -> shouldStopAfterTurn()
  -> drain steering queue
  -> 没工具且没 steering，则 drain followUp queue
  -> emit agent_end
```

### `convertToLlm` 的边界

低层 loop 接收 `AgentMessage[]`，但 provider 只理解 `Message[]`。

`convertToLlm` 是最后一道转换：

- 普通 user/assistant/toolResult 直接保留。
- 自定义消息可以转成 user message。
- UI-only 消息必须过滤。
- 不应抛异常；如果失败要返回安全 fallback。

`agentLoopContinue()` 有一个硬约束：转换后最后一条消息必须是 `user` 或 `toolResult`。如果最后是 assistant，provider 会拒绝。

### `transformContext` 的边界

`transformContext` 在 `convertToLlm` 前执行，用于 AgentMessage 层面的改写：

- 裁剪上下文。
- 注入外部上下文。
- 隐藏某些自定义消息。
- 做临时 prompt routing。

它不应该持久修改 session，只影响本次 provider 请求。

### 工具执行语义

默认工具执行模式是并行：

- 工具 call 先按 assistant 原顺序做 prepare/validation/preflight。
- 可执行工具并发执行。
- `tool_execution_end` 按完成顺序发出。
- `toolResult` message 按 assistant 原始 tool call 顺序写回。

如果满足任一条件，则整批工具顺序执行：

- `config.toolExecution === "sequential"`
- 任意工具声明 `executionMode: "sequential"`

### Tool hooks

`beforeToolCall`：

- 参数校验后执行。
- 可以返回 `{ block: true, reason }` 阻断工具。
- 阻断后 loop 会生成 error tool result。
- handler 需要自行尊重 abort signal。

`afterToolCall`：

- 工具执行后执行。
- 可以替换 `content`、`details`、`isError`、`terminate`。
- 是字段级替换，不是 deep merge。

`terminate`：

- 只有当前 batch 里的所有 finalized tool result 都 `terminate === true`，才提前停止后续工具循环。

## `packages/coding-agent` 层

### 责任

`packages/coding-agent` 把低层 agent 变成完整 coding agent 产品：

- CLI 启动。
- SDK 创建。
- session 存储和恢复。
- resource loading。
- extension runtime。
- 内置工具。
- system prompt 构造。
- print/rpc/interactive 模式。
- compaction/retry。

### 关键文件

| 文件 | 作用 |
| --- | --- |
| `src/main.ts` | CLI 入口，解析参数、选择 session、创建 runtime、分发 mode |
| `src/core/sdk.ts` | `createAgentSession()` 主 SDK 入口 |
| `src/core/agent-session.ts` | 高层 session，对外 API、prompt、tools、extensions、compaction、retry |
| `src/core/agent-session-services.ts` | cwd-bound services 创建 |
| `src/core/agent-session-runtime.ts` | 可切 session 的 runtime |
| `src/core/session-manager.ts` | JSONL session 存储、resume、fork、tree |
| `src/core/resource-loader.ts` | 加载 skills、prompts、themes、context files、extensions |
| `src/core/package-manager.ts` | 资源包、项目/用户/package 优先级 |
| `src/core/system-prompt.ts` | system prompt 构造 |
| `src/core/extensions/*` | 扩展系统 |
| `src/core/tools/*` | 内置工具定义 |
| `src/modes/rpc/*` | JSONL RPC server/client |
| `src/modes/print-mode.ts` | 单次 print/json 模式 |

## SDK 创建链路

### `createAgentSession()`

最简单入口。它会：

- 解析 cwd。
- 创建或使用传入的 `AuthStorage`。
- 创建或使用传入的 `ModelRegistry`。
- 创建或使用 `SettingsManager`。
- 创建或使用 `SessionManager`。
- 创建或使用 `DefaultResourceLoader`。
- 恢复已有 session 的 model/thinkingLevel。
- 找默认 model。
- 创建低层 `Agent`。
- 包装 `streamSimple`，注入 auth、retry、headers、timeout。
- 创建 `AgentSession`。

适合：

- demo。
- 单 session 程序。
- 测试。
- 不需要复杂 session 切换的工具。

### `createAgentSessionServices()`

创建 cwd-bound services：

- `cwd`
- `agentDir`
- `authStorage`
- `settingsManager`
- `modelRegistry`
- `resourceLoader`
- `diagnostics`

它会加载 resources，并应用扩展的 pending provider registrations。

重要边界：这些 services 绑定当前 cwd。session cwd 变化时必须重建。

### `createAgentSessionFromServices()`

基于已有 services 创建 `AgentSession`。

适合在自己的 runtime factory 中使用：

```text
create services for cwd
  -> resolve model/tools/session options
  -> create session from services
```

### `createAgentSessionRuntime()`

适合自研完整产品外壳。它管理：

- 初始 session。
- new session。
- switch/resume session。
- fork。
- import。
- dispose。
- session replacement 事件。

如果自研 agent 要支持 `/new`、`/resume`、`/fork`、项目切换，应使用 runtime，而不是直接持有一个 session。

## `AgentSession`

### 责任

`AgentSession` 是 coding-agent 的核心门面。它把低层 `Agent` 与 Pi 的产品能力拼在一起。

它负责：

- prompt/steer/followUp。
- session persistence。
- model/thinking 切换。
- active tools。
- extension bind。
- system prompt rebuild。
- compaction。
- auto retry。
- bash execution persistence。
- resource extension。

### 为什么不要绕过 `AgentSession`

绕过它会丢失：

- session 文件写入。
- extension 事件。
- resource discovery。
- system prompt rebuild。
- tool registry 合并。
- compaction/retry。
- model registry auth。
- bash pending message flush。

除非你在做新的底层 agent 框架，否则不要直接调用 `agentLoop()` 做产品能力。

### Prompt 链路

`AgentSession.prompt(text, options)` 的真实顺序：

```text
1. 如果 text 是 slash command，优先尝试 extension command。
2. 触发 input extension event。
3. input 可 continue / transform / handled。
4. 展开 skill command 和 prompt template。
5. 如果正在 streaming，必须指定 steer 或 followUp。
6. 非 streaming 时 flush pending bash messages。
7. 校验 model 和 auth。
8. 必要时先 compaction 并 continue。
9. 构造 user message。
10. 注入 pending nextTurn custom messages。
11. 触发 before_agent_start。
12. before_agent_start 可注入 custom message 或覆盖本轮 system prompt。
13. agent.prompt(messages)。
14. post-run 处理 retry / compaction / queued messages。
```

### Streaming 中的消息队列

如果 agent 正在运行，`prompt()` 必须指定：

```ts
await session.prompt("new instruction", { streamingBehavior: "steer" });
await session.prompt("next task", { streamingBehavior: "followUp" });
```

`steer`：

- 当前 assistant turn 的工具执行完成后注入。
- 在下一次 LLM call 前进入上下文。
- 适合中途纠偏。

`followUp`：

- agent 没有更多工具和 steering 后才注入。
- 适合排队下一个任务。

### Custom message

扩展可调用 `sendMessage()` 注入 custom message。

投递方式：

| deliverAs | 行为 |
| --- | --- |
| `steer` | streaming 时进 steering queue |
| `followUp` | streaming 时进 follow-up queue |
| `nextTurn` | 不立即触发，随下一个 user prompt 一起注入 |
| `triggerTurn` | 非 streaming 时立即启动一轮 |
| 未设置 | 非 streaming 时只写入 session，不触发 LLM |

## 工具系统

### 内置工具

内置工具固定为：

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

定义入口：`packages/coding-agent/src/core/tools/index.ts`

默认 active tools：

- `read`
- `bash`
- `edit`
- `write`

read-only 工具组：

- `read`
- `grep`
- `find`
- `ls`

### ToolDefinition 与 AgentTool

Pi 在 coding-agent 层使用 `ToolDefinition`，在 agent-core 层使用 `AgentTool`。

适配文件：`src/core/tools/tool-definition-wrapper.ts`

`ToolDefinition` 多了：

- `label`
- `promptSnippet`
- `promptGuidelines`
- `renderCall`
- `renderResult`
- extension context 参数

`AgentTool` 是低层可执行工具：

- `name`
- `description`
- `parameters`
- `prepareArguments`
- `executionMode`
- `execute`

### 工具 registry 合并

`AgentSession._refreshToolRegistry()` 做合并。

来源顺序：

```text
base built-in tool definitions
  -> extension registered tools
  -> SDK customTools
```

同名覆盖规则：

- 后加入的 custom/extension 工具会覆盖同名 built-in definition。
- registry 中最终以 tool name 为 key。

### Active tools

active tools 是真正传给模型的工具列表。不是 active 的工具即使在 registry 中，也不会被模型调用。

切换入口：

```ts
session.setActiveToolsByName(["read", "grep", "my_tool"]);
```

扩展中：

```ts
pi.setActiveTools(["read", "my_tool"]);
```

切换 active tools 会重建 system prompt，使提示词里的 Available tools 与实际工具一致。

### `tools` allowlist

SDK option `tools` 是 allowlist。

语义：

- 只暴露列出的工具。
- 过滤 built-in tools。
- 也过滤 extension/custom tools。
- 空数组表示禁用所有工具。

测试覆盖：`test/suite/regressions/2835-tools-allowlist-filters-extension-tools.test.ts`

### `excludeTools` denylist

SDK option `excludeTools` 是 denylist。

语义：

- 同时过滤 built-in 和 extension/custom tools。
- 优先级高于 allowlist。
- 被 exclude 的工具不出现在 all tools、active tools、system prompt。

测试覆盖：`test/suite/regressions/5109-exclude-tools.test.ts`

### `noTools`

`noTools` 有两种语义：

| 值 | 语义 |
| --- | --- |
| `"all"` | 禁用所有工具，包括扩展工具 |
| `"builtin"` | 不启用默认 built-in active tools，但保留 extension/custom tools 可用 |

注意：`noTools: "builtin"` 不等于无工具。扩展在 `session_start` 注册的工具仍可 active。

测试覆盖：`test/suite/regressions/3592-no-builtin-tools-keeps-extension-tools.test.ts`

### 工具权限拦截

权限逻辑集中在 `AgentSession._installAgentToolHooks()`。

`tool_call` extension event 可以：

- 读取 tool name。
- 读取已校验 input。
- 原地修改 input。
- 返回 `{ block: true, reason }` 阻断。

阻断后不会执行工具，模型会收到 error tool result。

示例用途：

- 禁止危险 bash 命令。
- 禁止写某些路径。
- 在执行前确认。
- 自动补全参数。
- 路径重定向到 sandbox。

风险：修改后的 input 不会二次 schema 校验。

### 工具结果拦截

`tool_result` extension event 可以：

- 替换 `content`。
- 替换 `details`。
- 修改 `isError`。

用途：

- 脱敏工具输出。
- 压缩工具输出。
- 对结果加结构化 metadata。
- 把某些错误降级为非错误。

### 内置工具细节

#### `read`

文件：`src/core/tools/read.ts`

能力：

- 读取文本。
- 读取图片并返回 image content。
- 支持 offset/limit。
- 图片可自动 resize。
- 输出截断。
- 使用 `resolveReadPath` 处理 macOS 文件名特殊变体。

注意：read 是上下文入口工具，输出会进入 LLM，必须注意截断和图片设置。

#### `bash`

文件：`src/core/tools/bash.ts`

能力：

- 执行 shell 命令。
- 支持 command prefix。
- 支持 shellPath。
- 支持 streaming update。
- 输出通过 `OutputAccumulator` 保留尾部。
- 超大输出可落临时文件。

注意：

- Bash 是风险最高的工具。
- 自研 agent 如果要安全执行，优先用 `tool_call` 拦截或自定义 `BashOperations`。
- 如果要远程执行，可以替换 operations。

#### `edit`

文件：`src/core/tools/edit.ts`, `src/core/tools/edit-diff.ts`

能力：

- 精确替换。
- 多 edit 一次提交。
- 支持旧单 edit 参数通过 `prepareArguments` 迁移到 `edits`。
- 检查 oldText 非空。
- 检查唯一匹配。
- 检查 overlap。
- 支持 fuzzy match：空白、引号、dash、unicode space 规范化。
- 保留 BOM。
- 保留原始行尾风格。
- 使用 `withFileMutationQueue` 串行化同一文件写入。
- 生成 diff 用于 UI 预览。

注意：

- edit 适合局部修改。
- 如果 oldText 不唯一，必须让模型提供更多上下文。
- fuzzy match 会在规范化空间替换，可能改变某些 Unicode 细节。

#### `write`

文件：`src/core/tools/write.ts`

能力：

- 创建或覆盖文件。
- 自动创建父目录。
- 使用同一文件 mutation queue。
- 渲染时做语法高亮。
- 大内容预览只展示前几行。

注意：

- write 是完整重写工具。
- 小改优先 edit。
- 大文件写入要注意模型输出完整性。

#### `grep`

文件：`src/core/tools/grep.ts`

能力：

- 调用 `rg`。
- 支持 regex/literal。
- 支持 ignoreCase。
- 支持 glob filter。
- 支持 context lines。
- respects `.gitignore`。
- 输出按 match limit 和 byte limit 截断。
- 长行按 `GREP_MAX_LINE_LENGTH` 截断。

注意：

- 默认 limit 是 100。
- context > 0 时会额外 read file，因此远程 operations 要实现 `readFile`。

#### `find`

文件：`src/core/tools/find.ts`

能力：

- 调用 `fd`。
- 支持 glob pattern。
- respects `.gitignore`。
- 支持 path-containing glob。
- 输出相对 search root。
- 支持 custom `glob` operations。

注意：

- pattern 包含 `/` 时会启用 `--full-path` 并可能补 `**/`。
- `--no-require-git` 用来在非 git 目录也应用层级 `.gitignore` 语义。

#### `ls`

文件：`src/core/tools/ls.ts`

能力：

- 列目录。
- 包含 dotfiles。
- 目录加 `/`。
- 大目录按 entry limit 和 byte limit 截断。

注意：

- 默认只列一级，不递归。
- 如果需要搜索文件，用 `find`。

### 输出截断

文件：`src/core/tools/truncate.ts`

默认限制：

- `DEFAULT_MAX_LINES = 2000`
- `DEFAULT_MAX_BYTES = 50KB`
- `GREP_MAX_LINE_LENGTH = 500`

策略：

- `truncateHead`：保留头部，适合 read/find/grep/ls。
- `truncateTail`：保留尾部，适合 bash 输出。
- `truncateLine`：截断单行，适合 grep match。

### 同一文件写入队列

文件：`src/core/tools/file-mutation-queue.ts`

目的：

- 防止并行工具调用同时改同一文件造成覆盖。
- `edit` 和 `write` 都通过该队列。

重要语义：

- 不同文件可以并行。
- 同一文件写入串行。
- abort 不应提前释放队列导致未完成 fs 操作随后落盘。

## 扩展系统

### 关键文件

| 文件 | 作用 |
| --- | --- |
| `src/core/extensions/types.ts` | 扩展 API、事件、工具定义类型 |
| `src/core/extensions/loader.ts` | 加载 extension factory，创建 ExtensionAPI |
| `src/core/extensions/runner.ts` | 事件派发、context、resources discover、provider/tool hooks |
| `src/core/extensions/wrapper.ts` | extension tool 到 AgentTool 适配 |

### Extension 注册期与运行期

扩展 factory 加载时可以注册：

- event handlers。
- tools。
- commands。
- shortcuts。
- flags。
- message renderers。
- providers。

真正依赖 session 的操作要等 runner bind 之后才有完整 context。

### Extension bind 与失效语义

Extension API 是双阶段运行模型：

```text
load extension factory
  -> 注册 handlers/tools/commands/shortcuts/flags/renderers/providers
  -> 创建 shared ExtensionRuntime
bindExtensions()
  -> bind core actions / command actions / UI context
  -> flush pending provider registrations
  -> emit session_start
  -> emit resources_discover
  -> append dynamic resources and rebuild system prompt
```

关键边界：

- `registerTool()` 在加载期可用；加载期调用会写入 extension 自己的 tool map。
- `sendMessage()`、`sendUserMessage()`、`appendEntry()`、`setActiveTools()` 等动作依赖 bind 后的 runtime action。
- `registerProvider()` 在加载期会进入 `pendingProviderRegistrations`，bind 后才写入 `ModelRegistry`。
- bind 后再次调用 `registerProvider()` / `unregisterProvider()` 会立即生效，不需要 `/reload`。
- `ctx.newSession()`、`ctx.fork()`、`ctx.switchSession()`、`ctx.reload()` 之后旧 ctx 会 stale。
- stale ctx 再调用 extension API 会抛错；替换 session 后的后续工作要放到 `withSession` 传入的新 ctx 中。

维护风险：不要在闭包里长期保存 `pi` 或 command ctx 后跨 session/reload 使用。扩展如果要长期状态，用 custom entry 或外部存储，下一次 `session_start` 恢复。

### 常用事件

| 事件 | 时机 | 用途 |
| --- | --- | --- |
| `session_start` | session 绑定后 | 初始化、注册动态工具、恢复扩展状态 |
| `session_shutdown` | session 替换或退出前 | 清理资源 |
| `resources_discover` | startup/reload | 动态注入 skills/prompts/themes |
| `input` | prompt 进入前 | 拦截、转换或处理用户输入 |
| `before_agent_start` | 本轮 agent 开始前 | 注入 custom message、覆盖本轮 system prompt |
| `context` | 每次 provider 请求前 | 临时改 LLM 上下文 |
| `before_provider_request` | provider payload 发送前 | 调试、审计、payload patch |
| `after_provider_response` | provider response 后 | 观测状态码和 headers |
| `tool_call` | 工具执行前 | 权限、参数修正、阻断 |
| `tool_result` | 工具执行后 | 脱敏、压缩、结果修正 |
| `message_end` | 消息 finalized 后 | 修改持久化消息 |
| `agent_end` | loop 结束 | 后处理、排队下一步 |
| `session_before_switch` | 切 session 前 | 可取消 |
| `session_before_fork` | fork 前 | 可取消 |
| `session_before_compact` | compaction 前 | 可取消或自定义 compaction |

### `input` 事件

返回值：

| action | 效果 |
| --- | --- |
| `continue` | 不改输入，继续原链路 |
| `transform` | 替换 text/images 后继续 |
| `handled` | 扩展已处理，不进入 agent prompt |

`input` 在 skill/template 展开之前运行。

### `before_agent_start`

可返回：

- `message`：注入一个 custom message。
- `systemPrompt`：覆盖本轮 system prompt。

多个扩展返回 `systemPrompt` 时按顺序链式覆盖。

注意：这是本轮 prompt 的覆盖，不等于修改 base system prompt。

### `context` 事件

`context` 能修改传给 provider 的消息，但不修改持久化 session。

典型用途：

- 给模型临时加入检索结果。
- 过滤某些 custom messages。
- 做上下文压缩实验。
- 对某个 provider 做上下文适配。

### `message_end` 事件

`message_end` 可以替换 finalized message。

限制：替换 message 必须保持原 role。

作用：

- 修改 usage/cost。
- 添加 label-like metadata。
- 标准化 assistant 输出。

测试覆盖：`test/suite/regressions/3982-message-end-cost-override.test.ts` 和 runtime characterization。

### Tool wrapper

Extension registered tools 会被 `wrapRegisteredTools()` 包装。

wrapper 只做一件事：给 tool `execute()` 传 runner context。

工具调用/结果拦截不在 wrapper 里做，而是在 `AgentSession` 安装的低层 hook 中统一处理。

### Extension commands 和 shortcuts

命令与快捷键由 `ExtensionRunner` 汇总：

- 同名 command 会保留所有注册项，但 invocation name 会按出现顺序加后缀，避免完全覆盖。
- interactive autocomplete 会隐藏与内置 slash command 同名的 extension command，或显示其后缀名。
- shortcut 会和 app keybindings 比较；保留的内置快捷键不能被 extension 覆盖。
- 非保留内置快捷键冲突会产生 warning，但 extension shortcut 可以生效。
- 多个 extension 注册同一个 shortcut 时，后注册项覆盖前注册项并产生诊断。

新增快捷键不要硬编码按键判断，应走 keybindings/shortcut 注册体系。

## 资源系统

### ResourceLoader

文件：`src/core/resource-loader.ts`

负责加载：

- system prompt。
- append system prompt。
- skills。
- prompt templates。
- themes。
- AGENTS/context files。
- extensions。

### PackageManager

文件：`src/core/package-manager.ts`

负责解析资源来源和优先级。

资源优先级大致为：

```text
项目显式资源
项目自动发现资源
用户显式资源
用户自动发现资源
package resource
```

冲突时先到者胜，并产生诊断。

### Resource reload 实际链路

`DefaultResourceLoader.reload()` 不是简单重读目录，真实顺序是：

```text
settingsManager.reload()
  -> packageManager.resolve()
  -> resolve CLI/temporary extension sources
  -> load extensions
  -> load inline extension factories
  -> detect extension conflicts
  -> load skills/prompts/themes with sourceInfo
  -> load AGENTS/CLAUDE context files
  -> load system prompt and append system prompt
```

资源发现要点：

- context files 会从 agentDir 和 cwd ancestors 收集 `AGENTS.md` / `CLAUDE.md`。
- `noExtensions` / `noSkills` / `noPromptTemplates` / `noThemes` 禁用自动和配置资源，但 CLI/temporary 路径仍可显式加入。
- extension `resources_discover` 返回的 skill/prompt/theme 会被标记为 temporary source，追加到 loader 当前资源集。
- 动态资源加入后会重新加载对应资源类型，并重建 base system prompt。
- `/reload` 会先发 `session_shutdown(reason: "reload")`，再重置 API providers、resource loader、extension runtime，并尽量保留 extension flags。

### Package resource 规则

Package 支持来源：

- `npm:<pkg>` 或 `npm:<pkg>@<version>`。
- git URL / shorthand。
- 本地路径。

发现规则：

- package 根目录 `package.json` 里的 `pi.extensions` / `pi.skills` / `pi.prompts` / `pi.themes` 优先。
- extension package 如果没有 manifest，则优先用根目录 `index.ts` / `index.js`。
- extension 目录没有根入口时，会发现子目录里的 package manifest 或 index 文件。
- skills 在 `.pi` 风格下支持根级 markdown，也支持目录内 `SKILL.md`。
- prompts 是 markdown，themes 是 json。
- `.gitignore` / `.ignore` / `.fdignore` 会参与资源发现过滤。

Filter 规则：

- 普通 pattern：只 include 匹配资源。
- `!pattern`：排除匹配资源。
- `+path`：精确强制加入，覆盖排除。
- `-path`：精确强制排除，覆盖强制加入。

维护风险：package 资源优先级最低，不能依赖 package 覆盖项目资源。需要覆盖时应使用项目显式资源，或调整 package filter，而不是改 collision 规则。

### `resources_discover`

扩展可以通过该事件动态添加：

- `skillPaths`
- `promptPaths`
- `themePaths`

`AgentSession.extendResourcesFromExtensions()` 会追加这些资源并重建 system prompt。

注意：动态资源是临时扩展资源，不应把环境细节硬编码进正式文档。

## System Prompt 构造

文件：`src/core/system-prompt.ts`

输入：

- cwd。
- skills。
- context files。
- custom system prompt。
- append system prompt。
- selected active tools。
- tool snippets。
- prompt guidelines。

关键点：

- system prompt 只列 active tools。
- active tools 改变后会 rebuild。
- 扩展资源注入后会 rebuild。
- `before_agent_start` 可以覆盖本轮 system prompt。
- `promptGuidelines` 来自 active tools，用于指导模型正确使用工具。

## Session 系统

### SessionManager

文件：`src/core/session-manager.ts`

负责：

- JSONL session 文件。
- session header。
- message entries。
- model/thinking changes。
- compaction entries。
- branch summary entries。
- custom entries。
- labels。
- fork。
- resume。
- tree traversal。

### Session context 构造

恢复 session 时不是简单读所有 messages，而是根据分支、compaction、summary 构造当前上下文。

重要点：

- compaction 会替换旧上下文为 summary。
- branch summary 用于导航分支。
- custom entries 可以持久化扩展状态，但默认不进 LLM。
- custom messages 是否进 LLM 取决于 `convertToLlm` 或 extension `context`。

### Runtime session 替换

`AgentSessionRuntime` 管理 session replacement。

典型流程：

```text
session_before_switch / session_before_fork
  -> 可取消
session_shutdown
  -> dispose old session
create services for target cwd
create session from services
bind extensions
session_start
resources_discover
```

测试覆盖：`test/suite/agent-session-runtime.test.ts`

## Compaction 与 Retry

### Auto retry

`AgentSession` 根据 assistant error message 判断是否可 retry。

不可 retry 的例子：

- provider 使用额度不足。
- balance/quota/billing 问题。
- context overflow。

可 retry 的例子：

- overloaded。
- rate limit。
- 429/500/502/503/504。
- network/connection reset。
- websocket close。
- stream ended unexpectedly。

retry 使用 settings 中的 base delay 和 max retries。

### Compaction

compaction 触发场景：

- 手动。
- threshold。
- overflow recovery。

扩展点：

- `session_before_compact` 可取消。
- `session_before_compact` 可返回自定义 compaction。
- `session_compact` 在保存 compaction 后发出。

自研 agent 如果要实现自己的长期记忆，优先从 compaction extension 切入。

## RPC 模式

### 文件

| 文件 | 作用 |
| --- | --- |
| `src/modes/rpc/rpc-mode.ts` | RPC server mode |
| `src/modes/rpc/rpc-client.ts` | typed RPC client |
| `src/modes/rpc/jsonl.ts` | JSONL reader/writer |

### 协议

RPC 是严格 JSONL：

- 一行一个 JSON。
- 只按 `\n` 分帧。
- 不使用会拆 Unicode 行分隔符的通用 line reader。
- stdout backpressure 有处理。
- detached child cleanup 有处理。

常用命令：

- `prompt`
- `steer`
- `follow_up`
- `abort`
- `new_session`
- `switch_session`
- `get_state`
- `set_model`
- `extension_ui_response`

适合：

- 非 Node 语言控制 Pi。
- 进程隔离。
- 服务端作为子进程驱动 Pi。

不适合：

- 需要深度改工具实现。
- 需要直接共享内存状态。
- 需要强类型 extension API。

## Print 模式

文件：`src/modes/print-mode.ts`

适合：

- 单次 prompt。
- shell 脚本。
- CI 中运行一次性任务。
- JSON 输出。

注意：print mode 仍走 session/runtime/resource/model/tool 链路，不是简化版 agent。

## Interactive 模式

Interactive 是完整 TUI 外壳。

`InteractiveMode.bindCurrentSessionExtensions()` 会传入：

- `mode: "tui"`
- 完整 `uiContext`
- `abortHandler`
- `shutdownHandler`
- `commandContextActions`
- extension error renderer

bind 后会重新设置 autocomplete、extension shortcuts，并展示资源与诊断。

Interactive extension UI 支持：

- `select` / `confirm` / `input` / `editor` / `custom`。
- `notify` / `setStatus` / working indicator / hidden thinking label。
- `setWidget` above/below editor，widget 总行数有限制。
- `setHeader` / `setFooter` 替换内置组件，旧组件会 dispose。
- `pasteToEditor` / `setEditorText` / `getEditorText`。
- `setEditorComponent` / `getEditorComponent`。
- `addAutocompleteProvider`。
- theme 查询与切换。
- tools expanded 状态读写。

Session replacement 前 interactive 会调用 `resetExtensionUI()`，清理 selector/input/editor/overlay/listeners/header/footer/widgets/status/autocomplete/custom editor/shortcuts/working label，然后 rebind 新 session。

风险：自定义 editor 如果不继承或转发默认 editor 行为，会丢 app keybindings、extension shortcuts、autocomplete、paste image 等能力。

自研 agent 默认不需要改 interactive。只有以下目标才需要读它：

- 改 UI 布局。
- 增加 TUI widget。
- 改 keybinding。
- 改 selector/dialog。
- 做 overlay 游戏或复杂交互。

测试交互模式时项目规则建议用 tmux，不要裸跑后靠猜测状态。

### Print 和 RPC 的 UI 差异

Print/json mode：

- 绑定 `mode: "print"` 或 `mode: "json"`。
- 提供 command context actions。
- 不提供真实 TUI `uiContext`。
- json mode 只向 stdout 输出 session events。

RPC mode：

- 绑定 `mode: "rpc"`。
- extension UI 通过 `extension_ui_request` / `extension_ui_response` 桥接。
- 支持基础 select/confirm/input/editor/notify/status/widget/title/editor text。
- header/footer/custom editor/autocomplete/custom component/theme 切换等 TUI 专属能力基本不可用或 no-op。

扩展里需要根据 `ctx.mode` / `ctx.hasUI` 分支，不要假设 print、RPC、TUI 有同样 UI 能力。

## 自研路线选择

### 路线 1：Extension 优先

适合：

- 改 system prompt。
- 加权限确认。
- 加工具。
- 注册 provider。
- 动态切 active tools。
- 做模式，比如 plan mode。
- 注入资源。
- 改工具结果。

优点：

- 最少改动。
- 不破坏 Pi 升级路径。
- 保留 CLI/TUI/RPC/SDK 全能力。

缺点：

- 不能替换底层 agent loop 的核心调度。
- 对 UI 深改有限。

推荐默认选择。

### 路线 2：SDK Runtime 产品外壳

适合：

- 做自己的 CLI。
- 做自己的服务端。
- 做桌面或 Web 后端。
- 保留 Pi 的 session、tools、extensions、provider。
- 需要多 session 管理。

核心模式：

```ts
const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({ cwd, agentDir, authStorage });
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model,
      tools,
      customTools,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd,
  agentDir,
  sessionManager,
});
```

优点：

- 保留 Pi 核心能力。
- 自己控制产品外壳。
- session 切换语义正确。

缺点：

- 需要自己处理 UI/事件展示。
- 需要管理 runtime disposal。

### 路线 3：RPC 外壳

适合：

- Python/Go/Rust 等非 Node 控制。
- 需要子进程隔离。
- 想把 Pi 当本地 agent server。

优点：

- 语言无关。
- 与现有 CLI 行为一致。
- 状态由 Pi 进程维护。

缺点：

- JSONL 协议调试成本高。
- 自定义工具/provider 不如 extension/SDK 直接。
- 需要进程生命周期管理。

### 路线 4：Fork CLI/TUI

适合：

- 改 TUI。
- 改启动参数和 mode 分发。
- 改 session selector。
- 改交互输入核心行为。

不推荐作为第一选择。

风险：

- 升级成本高。
- 容易破坏 extension/session/resource 边界。
- 需要更多 UI 测试。

## 常见开发任务手册

### 加一个自定义工具

优先 extension：

```ts
import { Type } from "typebox";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const extension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Do one specific thing",
    promptSnippet: "Use my_tool when you need that specific thing",
    parameters: Type.Object({
      input: Type.String(),
    }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      if (signal?.aborted) throw new Error("Operation aborted");
      return {
        content: [{ type: "text", text: `got ${params.input}` }],
        details: { ok: true },
      };
    },
  });
};

export default extension;
```

检查点：

- name 要稳定。
- description 要告诉模型何时用。
- schema 要尽量窄。
- promptSnippet 要短。
- execute 要尊重 abort signal。
- 输出要控制长度。
- details 用于 UI/调试，不要塞大对象。

### 加权限门

用 `tool_call`：

```ts
const extension: ExtensionFactory = (pi) => {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command = String((event.input as { command?: unknown }).command ?? "");
    if (command.includes("rm -rf")) {
      return { block: true, reason: "Dangerous command blocked" };
    }
  });
};
```

检查点：

- 阻断返回 reason，模型会看到该错误。
- 如果需要用户确认，使用 extension UI context。
- 修改参数时保持 schema 合法。
- 不要只靠 system prompt 做安全限制。

### 改工具结果

用 `tool_result`：

```ts
const extension: ExtensionFactory = (pi) => {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash") return;
    return {
      content: event.content.map((part) =>
        part.type === "text"
          ? { type: "text", text: part.text.replace(/token=\S+/g, "token=[redacted]") }
          : part,
      ),
    };
  });
};
```

检查点：

- content 是完整替换。
- details 也是完整替换。
- 不要把真实密钥写入 details。

### 自定义 provider

如果复用已有 API 协议：

```ts
pi.registerProvider("my-proxy", {
  baseUrl: "https://proxy.example.com",
  apiKey: "$MY_PROXY_API_KEY",
  api: "anthropic-messages",
  models: [
    {
      id: "claude-sonnet-proxy",
      name: "Claude Sonnet Proxy",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384,
    },
  ],
});
```

如果是新协议：

- 注册 models。
- 设置新的 `api`。
- 提供 `streamSimple` handler。
- 确保 handler 返回标准 AssistantMessageEventStream。
- 错误要编码成 final assistant message，不要直接 throw。

Dynamic provider lifecycle：

- `pi.registerProvider()` 最终落到 `ModelRegistry.registerProvider()`。
- 带 `models` 会替换该 provider 下所有现有模型。
- 只带 `baseUrl` / `headers` 会覆盖已有 provider 模型的请求配置。
- 带 `oauth` 会注册 OAuth provider，供 `/login` 使用。
- 带 `streamSimple` 必须同时指定 `api`，并向 `packages/ai` 的 API registry 注册 stream handler。
- `unregisterProvider()` 会移除动态 provider，然后 refresh 恢复 built-in/custom model 状态。

风险：`streamSimple` 是按 `api` 注册，不是按 provider 注册。同一个 `api` 后注册会覆盖先注册的 stream handler。除非确实新增请求协议，否则自定义模型代理应优先复用已有 `api`，只改 `baseUrl`、`headers`、`apiKey`、`models`。

Provider 注册时机：

- extension 顶层调用：resource load 期间先 pending，services/session bind 时生效。
- `session_start` 调用：bindExtensions 发事件时生效。
- command handler 调用：命令执行时立即生效，不需要 reload。

`AgentSession` 会在 provider 变化后刷新当前 model 引用，避免当前 session 继续拿旧 `baseUrl`。

### 动态切工具模式

用 `setActiveTools()`：

```ts
const extension: ExtensionFactory = (pi) => {
  pi.on("session_start", () => {
    pi.setActiveTools(["read", "grep", "find", "ls"]);
  });
};
```

检查点：

- unknown tool 会被忽略。
- active tools 改变会 rebuild system prompt。
- allowlist/denylist 仍然生效。

### 做 plan mode

参考：`packages/coding-agent/examples/extensions/plan-mode/index.ts`

关键做法：

- 启动时切 active tools。
- 用 `before_agent_start` 注入模式提示。
- 用 `context` 过滤或调整上下文。
- 用 `agent_end` 决定是否继续。
- 用 session custom entries 恢复状态。

### 给自研外壳接 SDK Runtime

最小结构：

```ts
const services = await createAgentSessionServices({ cwd, agentDir });
const { session } = await createAgentSessionFromServices({
  services,
  sessionManager,
  model,
});

session.subscribe((event) => {
  // render or log events
});

await session.bindExtensions({});
await session.prompt("hello");
```

如果要支持切 session，使用 `createAgentSessionRuntime()`，不要自己手写替换流程。

## 测试和验证

### 项目规则

文档改动不需要运行 build/test。

代码改动后按项目规则：

- 运行 `npm run check`。
- 不主动运行 `npm run build`。
- 不主动运行 `npm test`。
- 不直接运行完整 vitest suite。
- 非 e2e 测试优先用 repo root 的 `./test.sh`。
- 具体测试可在 package root 跑指定 vitest 文件。

### 关键测试文件

| 测试 | 覆盖内容 |
| --- | --- |
| `packages/agent/test/agent-loop.test.ts` | agent loop、工具执行、参数 prepare、队列、并行/顺序 |
| `packages/coding-agent/test/test-harness.ts` | 老 harness：内存 session、faux streamFn、事件收集 |
| `packages/coding-agent/test/suite/harness.ts` | suite harness：faux provider、真实 AgentSession/runtime 行为 |
| `packages/coding-agent/test/suite/agent-session-prompt.test.ts` | prompt 链路 |
| `packages/coding-agent/test/suite/agent-session-queue.test.ts` | steering/follow-up |
| `packages/coding-agent/test/suite/agent-session-runtime.test.ts` | runtime session replacement |
| `packages/coding-agent/test/suite/agent-session-model-extension.test.ts` | extension hooks、model、context、input |
| `packages/coding-agent/test/suite/agent-session-compaction.test.ts` | compaction |
| `packages/coding-agent/test/extensions-runner.test.ts` | extension runner、命令/快捷键冲突、provider 注册 |
| `packages/coding-agent/test/extensions-discovery.test.ts` | extension 文件和 package manifest 发现 |
| `packages/coding-agent/test/interactive-mode-status.test.ts` | interactive extension UI/status/autocomplete/resources display |
| `packages/coding-agent/test/model-registry.test.ts` | model registry 和 dynamic provider lifecycle |
| `packages/coding-agent/test/agent-session-dynamic-provider.test.ts` | extension provider 顶层/session_start/command-time 生效 |
| `packages/coding-agent/test/resource-loader.test.ts` | resource loader、资源优先级、extension dynamic resources |
| `packages/coding-agent/test/package-manager.test.ts` | package source 解析、filter、资源发现 |
| `packages/coding-agent/test/package-command-paths.test.ts` | package command 路径持久化和 self-update |
| `packages/coding-agent/test/rpc-jsonl.test.ts` | JSONL framing |
| `packages/coding-agent/test/rpc-prompt-response-semantics.test.ts` | RPC prompt response 结算语义 |
| `packages/coding-agent/test/rpc.test.ts` | RPC behavior |
| `packages/coding-agent/test/tools.test.ts` | tools 基础行为 |
| `packages/coding-agent/test/suite/regressions/2835-tools-allowlist-filters-extension-tools.test.ts` | allowlist 过滤扩展工具 |
| `packages/coding-agent/test/suite/regressions/3592-no-builtin-tools-keeps-extension-tools.test.ts` | no builtin 工具语义 |
| `packages/coding-agent/test/suite/regressions/5109-exclude-tools.test.ts` | excludeTools 优先级 |
| `packages/coding-agent/test/suite/regressions/3302-find-path-glob.test.ts` | find path glob |
| `packages/coding-agent/test/suite/regressions/3303-find-nested-gitignore.test.ts` | find nested gitignore |
| `packages/ai/test/validation.test.ts` | tool arguments validation |
| `packages/ai/test/transform-messages-copilot-openai-to-anthropic.test.ts` | message transform |
| `packages/ai/test/tool-call-id-normalization.test.ts` | tool call id |

### 什么时候跑哪些测试

修改 agent loop：

```bash
cd packages/agent
node ../../node_modules/vitest/dist/cli.js --run test/agent-loop.test.ts
```

修改 tools：

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/tools.test.ts
```

修改 tool allow/exclude：

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/2835-tools-allowlist-filters-extension-tools.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/3592-no-builtin-tools-keeps-extension-tools.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/5109-exclude-tools.test.ts
```

修改 runtime/session：

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-runtime.test.ts
```

修改 provider/message transform：

```bash
cd packages/ai
node ../../node_modules/vitest/dist/cli.js --run test/validation.test.ts
```

修改 extension runner/discovery/UI：

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/extensions-runner.test.ts test/extensions-discovery.test.ts test/interactive-mode-status.test.ts
```

修改 dynamic provider：

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/model-registry.test.ts test/agent-session-dynamic-provider.test.ts
```

修改 resource/package：

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/resource-loader.test.ts test/package-manager.test.ts test/package-command-paths.test.ts
```

修改 RPC：

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/rpc-jsonl.test.ts test/rpc-prompt-response-semantics.test.ts test/rpc.test.ts
```

新增 issue-specific regression：

- 放在 `packages/coding-agent/test/suite/regressions/`。
- 文件名用 `<issue-number>-<short-slug>.test.ts`。
- 使用 `test/suite/harness.ts` 和 faux provider，不打真实 provider。

最终代码改动后：

```bash
npm run check
```

## 设计原则

### 不要绕过这些边界

不要绕过 `AgentSession`：会丢 session、extension、compaction、retry、tool registry。

不要绕过 `streamSimple`：会丢 provider registry 和统一 stream 协议。

不要绕过 `transformMessages`：会破坏跨 provider replay。

不要只靠 system prompt 做安全：用 `tool_call` 硬拦截。

不要把所有自定义逻辑塞到 bash：优先做 typed tool。

不要把长期状态只放内存：用 custom entries 或外部存储。

不要在 cwd 切换后复用旧 services：重新创建 cwd-bound services。

### 扩展优先级判断

用 extension，如果目标是：

- 改 prompt。
- 加工具。
- 拦截工具。
- 改输入。
- 改 provider。
- 动态资源。
- 自定义 command。

用 SDK runtime，如果目标是：

- 做自己的 agent 产品外壳。
- 多 session 管理。
- 自己渲染事件。
- 自己接 Web/API。

用 RPC，如果目标是：

- 非 Node 语言控制。
- 子进程隔离。
- 复用现成 Pi 进程。

改源码，如果目标是：

- 改底层 loop。
- 改 TUI。
- 改 session 文件格式。
- 改内置工具通用语义。

## 常见坑

### `noTools: "builtin"` 不是禁用所有工具

它只是不启用默认 built-in active tools。扩展工具仍可能 active。

如果要禁用所有工具，用 `noTools: "all"` 或 `tools: []`。

### `excludeTools` 比 `tools` 更强

即使工具在 allowlist 中，只要在 excludeTools 中也会被过滤。

### `tool_call` 修改参数不二次校验

扩展修正参数时必须自己保证类型正确。

### 并行工具结果写回顺序不是完成顺序

`tool_execution_end` 按完成顺序。  
`toolResult` message 按 assistant tool call 原顺序。

不要用 event 完成顺序推断 LLM 看到的顺序。

### `before_agent_start` 覆盖的是本轮 prompt

它不会永久修改 base system prompt。若要永久改，用 resource/system prompt 或 active tools rebuild。

### `context` 改的是 provider 请求上下文

它不会改 session 中存储的原始消息。

### RPC JSONL 不能用普通 line splitter 乱拆

必须按 `\n` 分帧，保留其他 Unicode 行分隔符在 JSON 字符串内的语义。

### CWD-bound services 不能跨项目复用

settings、resources、extensions、session dirs 都依赖 cwd。

切 session/cwd 时用 runtime factory 重建。

### Extension ctx 不能跨 reload/session replacement 复用

`ctx.newSession()`、`ctx.fork()`、`ctx.switchSession()`、`ctx.reload()` 后旧 ctx 会 stale。

后续工作要放到 `withSession` 传入的新 ctx 中，或等下一次 `session_start` 恢复状态。

### `streamSimple` 是按 `api` 全局注册

自定义 provider 带 `streamSimple` 时会注册到 API registry，同 `api` 后注册覆盖先注册。

如果只是代理已有 provider，优先改 `baseUrl` / `headers` / `apiKey` / `models`，不要新增或覆盖 stream handler。

### TUI UI 能力不等于 RPC/print UI 能力

`ctx.ui` 在 TUI 最完整；RPC 只桥接基础 dialog/editor/status；print/json 基本没有真实 UI。

扩展要用 `ctx.mode` / `ctx.hasUI` 分支处理，不要在非 TUI mode 里依赖 header/footer/autocomplete/custom editor。

### `resources_discover` 在 `session_start` 之后

动态资源是在 session_start 后发现，再追加进 ResourceLoader 并重建 system prompt。

如果 extension 初始化依赖自己动态注入的 skill/prompt/theme，不要假设它们在同一个 `session_start` handler 里已经完成加载。

### 内置 `models.generated.ts` 不直接改

如果要更新模型元数据，改生成脚本后 regenerate。

## 后续开发快速决策表

| 需求 | 推荐入口 | 不推荐 |
| --- | --- | --- |
| 加一个领域工具 | extension `registerTool` | 改内置 tools/index |
| 禁止危险 bash | extension `tool_call` | 只写 prompt |
| 接自定义模型代理 | extension `registerProvider` | 手改 provider 请求体 |
| 做自己的 CLI | SDK runtime | fork main.ts 起步 |
| Python 控制 Pi | RPC | 直接 import TS |
| 改 system prompt | resource 或 `before_agent_start` | 改 agent-loop |
| 动态切只读模式 | `setActiveTools` | 删除工具 |
| 做计划模式 | extension + active tools + context | 新写低层 loop |
| 会话切换 | `AgentSessionRuntime` | 手动替换 session |
| 长期记忆 | compaction/custom entries/extension storage | 塞进 system prompt |

## 推荐自研起步方案

第一阶段：extension 原型。

- 写一个 extension。
- 注册自己的工具。
- 注册 `tool_call` 权限门。
- 用 `before_agent_start` 加角色和任务策略。
- 用 `context` 控制给模型的上下文。
- 用 `session_start` 恢复状态。

第二阶段：SDK runtime 外壳。

- 用 `createAgentSessionServices()`。
- 用 `createAgentSessionFromServices()`。
- 用 `createAgentSessionRuntime()` 管理 session。
- 自己订阅 session events 并渲染。
- 保留 extension 能力。

第三阶段：产品化。

- 加配置层。
- 加自定义 resource loader 或 package。
- 加测试 harness。
- 加针对工具和权限的 regression tests。
- 只在必要时改 Pi 源码。

## 重要代码索引

| 目标 | 文件 |
| --- | --- |
| SDK 创建 | `packages/coding-agent/src/core/sdk.ts` |
| cwd-bound services | `packages/coding-agent/src/core/agent-session-services.ts` |
| runtime session 切换 | `packages/coding-agent/src/core/agent-session-runtime.ts` |
| session 高层 API | `packages/coding-agent/src/core/agent-session.ts` |
| session 存储 | `packages/coding-agent/src/core/session-manager.ts` |
| system prompt | `packages/coding-agent/src/core/system-prompt.ts` |
| model registry | `packages/coding-agent/src/core/model-registry.ts` |
| resource loader | `packages/coding-agent/src/core/resource-loader.ts` |
| package manager | `packages/coding-agent/src/core/package-manager.ts` |
| extension types | `packages/coding-agent/src/core/extensions/types.ts` |
| extension loader | `packages/coding-agent/src/core/extensions/loader.ts` |
| extension runner | `packages/coding-agent/src/core/extensions/runner.ts` |
| tool wrapper | `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts` |
| tools index | `packages/coding-agent/src/core/tools/index.ts` |
| read tool | `packages/coding-agent/src/core/tools/read.ts` |
| bash tool | `packages/coding-agent/src/core/tools/bash.ts` |
| edit tool | `packages/coding-agent/src/core/tools/edit.ts` |
| edit diff | `packages/coding-agent/src/core/tools/edit-diff.ts` |
| write tool | `packages/coding-agent/src/core/tools/write.ts` |
| grep tool | `packages/coding-agent/src/core/tools/grep.ts` |
| find tool | `packages/coding-agent/src/core/tools/find.ts` |
| ls tool | `packages/coding-agent/src/core/tools/ls.ts` |
| truncation | `packages/coding-agent/src/core/tools/truncate.ts` |
| output accumulator | `packages/coding-agent/src/core/tools/output-accumulator.ts` |
| path utils | `packages/coding-agent/src/core/tools/path-utils.ts` |
| low-level Agent | `packages/agent/src/agent.ts` |
| low-level loop | `packages/agent/src/agent-loop.ts` |
| agent types | `packages/agent/src/types.ts` |
| stream dispatch | `packages/ai/src/stream.ts` |
| provider registry | `packages/ai/src/api-registry.ts` |
| message transform | `packages/ai/src/providers/transform-messages.ts` |
| tool validation | `packages/ai/src/utils/validation.ts` |
| RPC mode | `packages/coding-agent/src/modes/rpc/rpc-mode.ts` |
| RPC client | `packages/coding-agent/src/modes/rpc/rpc-client.ts` |
| RPC JSONL | `packages/coding-agent/src/modes/rpc/jsonl.ts` |
| print mode | `packages/coding-agent/src/modes/print-mode.ts` |
| interactive mode | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` |
| CLI main | `packages/coding-agent/src/main.ts` |

## 最终开发准则

后续开发自己的 pi agent 时，默认执行以下准则：

1. 先判断需求属于 extension、SDK runtime、RPC 还是源码改动。
2. 能用 extension 完成的，不改 core。
3. 能用 SDK runtime 完成的，不 fork CLI。
4. 能用 provider registry 完成的，不手拼 provider 请求。
5. 能用 ToolDefinition 完成的，不把逻辑塞进 bash。
6. 涉及工具安全，必须用 `tool_call` 硬拦截。
7. 涉及 session/cwd 切换，必须通过 runtime factory 重建 services。
8. 涉及上下文展示与持久化，要区分 `context` 临时改写和 `message_end` 持久改写。
9. 涉及输出大文本，必须考虑 truncation 和 full output 保存策略。
10. 涉及文件写入，必须考虑同一文件 mutation queue。
11. 涉及测试，优先用 faux provider 和现有 harness，不打真实 provider。
12. 涉及 extension session replacement/reload，不复用旧 ctx 或旧 session 引用。
13. 涉及 extension UI，按 `ctx.mode` / `ctx.hasUI` 区分 TUI、RPC、print 能力。
14. 完成代码改动后按项目规则跑 `npm run check`，文档改动无需 build/test。
