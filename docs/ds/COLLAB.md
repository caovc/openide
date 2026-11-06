# 多 code agent 协作协议

## 入口、协调人与通信状态源

本环境 **OpenIDE大师** 为协调者。所有 agent 先读根 `AGENTS.md` 的 DS 节，再读本文与 `.agents/BOARD.md`。聊天用于通知；**唯一任务状态源**是协调 worktree `/workspace/openide/.agents/BOARD.md`。各 worktree 的 BOARD 副本可能过期，不能作为独立认领依据。

BOARD 状态只用 `pending` / `in_progress` / `done` / `blocked`。`pending` 无所有者；`in_progress` 必须填 owner、分支、路径范围；`done` 必须有结论和证据；`blocked` 必须写原因、需要谁做什么、已完成的可移交部分。没有验证不得写 done。

## 认领与通信：先串行分配，再并行执行

1. agent 向 OpenIDE大师提交：unit、agent 名、拟用 `ds/<unit>-<slug>` 分支、具体路径/glob、依赖接口及验收命令。
2. **仅协调者写 canonical BOARD**，串行检查路径交叠并更新 owner/status/branch/notes；协调者确认认领生效后，agent 才能编辑。不能通过各自修改 BOARD 副本“抢到任务”。同一时间只允许一个 BOARD 写入者；协调者更替需显式交接。
3. 共享 box 上可直接读取 canonical BOARD；远程 agent 由协调者提供其最新内容。BOARD 尚未纳入共享基线时，协调者把最新 AGENTS/docs 及 BOARD 快照发给该 agent，不能假定新 worktree 自动包含未提交文件。
4. 每个 agent 只写自己的 worktree 和已认领路径，不写其他 agent 的目录或 canonical BOARD。每完成一个可验证小步、发现阻塞或变更接口，向协调者交接；协调者同步 BOARD notes。路径扩大或依赖变更须先重新认领。
5. 交接格式：`unit | status | owner | branch | base SHA | 路径 | 结论 | 验证命令/退出码 | 证据路径 | 未完成/阻塞 | 下一位动作`。没有可用消息通道时，在自己的 `.agents/handoffs/<unit>-<agent>.md` 保存同格式材料，并把文件位置交给协调者，不伪称已通知。该交接文件也须先认领。

## Worktree 与构建隔离

一人一 worktree、一任务一分支 `ds/<unit>-<slug>`。以下命令由任务 agent 在**认领后**执行；`<trunk-ref>` 取协调者指定的本地集成基线（初始为 `main`，不要假设空的 `origin/main` 可用）：

```bash
git worktree add ../openide-<unit>-<slug> -b ds/<unit>-<slug> <trunk-ref>
cd ../openide-<unit>-<slug>
export CARGO_TARGET_DIR="$PWD/target"
```

不共享 `target/`，不把它 symlink 到其他 worktree，不使用公共 `CARGO_TARGET_DIR`；应用、端口、进程按上游 worktree 规则隔离。仅停止自己启动且有 PID/归属证据的进程，禁止宽泛 pkill。重型构建由协调者排队，避免争抢资源。

当前准备阶段**不 commit、不 push**，由协调者统一处理。后续只有获得明确授权才提交/发布；认领任务不是 push 或开 PR 的授权。不要为创建 worktree 丢弃现有未提交文件。

## 路径所有权（初始规划）

<<<<<<< Updated upstream
| 单位             | 路径范围                                                                   | 约束                                                        |
| ---------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 协调者           | `AGENTS.md`、`docs/ds/**`、canonical `.agents/BOARD.md`、`.gitignore`      | 规则与状态板单写者；其他 agent 提议修改，不直接抢写。       |
| U1 / OpenIDE大师 | `crates/ide-notebook/**`，包括新 `crates/ide-notebook/tests/**`            | 仅 headless 启动接缝、会话 comm 分发和集成探针；UI 先不动。 |
| U2               | notebook runtime 描述及必要 host/Tauri 接缝                                | pending；与 U1 的 notebook 路径重叠，须交接/释放后再认领。  |
| U3               | 环境发现与 notebook kernel 选择                                            | pending；具体目录先列明，再确认与 U2/UI 所有权无冲突。      |
| U4               | `languages/r.toml`、`crates/ide-lsp/**` 及必要编辑器接线                   | pending；`languages/r.toml` 属后续单位，U1 不修改。         |
| U5               | DAP / stdin 管线                                                           | pending；涉及 notebook 的修改须重新协调路径。               |
| U6               | `src/features/ds-session/**` + 必要时 `crates/ide-notebook` 变量/plot 适配 | 共用 R/Python Session 变量/图表；与 U7 路径隔离。           |
| U7               | `src/features/ds-console/**`                                               | 独立 Console；不改 ide-notebook（U6 独占）。                |
| U8               | 编辑器 Run actions + Console 会话路由                                      | 依赖 U7。                                                   |
| U9               | DS data explorer / widgets                                                 | 先审 dbx 许可；SAS 扩展契约。                               |
| U10              | Windows SAS                                                                | 后置。                                                      |
| U11              | JVM 硬删除                                                                 | Later / 阶段 B。                                            |
=======
| 单位 | 路径范围 | 约束 |
| --- | --- | --- |
| 协调者 | `AGENTS.md`、`docs/ds/**`、canonical `.agents/BOARD.md`、`.gitignore` | 规则与状态板单写者；其他 agent 提议修改，不直接抢写。 |
| U1 / OpenIDE大师 | `crates/ide-notebook/**`，包括新 `crates/ide-notebook/tests/**` | 仅 headless 启动接缝、会话 comm 分发和集成探针；UI 先不动。 |
| U2 | notebook runtime 描述及必要 host/Tauri 接缝 | pending；与 U1 的 notebook 路径重叠，须交接/释放后再认领。 |
| U3 | 环境发现与 notebook kernel 选择 | pending；具体目录先列明，再确认与 U2/UI 所有权无冲突。 |
| U4 | `languages/r.toml`、`crates/ide-lsp/**` 及必要编辑器接线 | pending；`languages/r.toml` 属后续单位，U1 不修改。 |
| U5 | DAP / stdin 管线 | pending；涉及 notebook 的修改须重新协调路径。 |
| U6 | `src/features/ds-session/**` + 必要时 `crates/ide-notebook` 变量/plot 适配 | 共用 R/Python Session 变量/图表；与 U7 路径隔离。 |
| U7 | `src/features/ds-console/**` | 独立 Console；不改 ide-notebook（U6 独占）。 |
| U8 | 编辑器 Run actions + Console 会话路由 | 依赖 U7。 |
| U9 | DS data explorer / widgets | 先审 dbx 许可；SAS 扩展契约。 |
| U10 | Windows SAS | 后置。 |
| U11 | JVM 硬删除 | Later / 阶段 B。 |
>>>>>>> Stashed changes

该表是规划，不自动授予 pending 单位写权限。两个任务必须改同一文件时，先冻结相关修改、由协调者定接口与先后顺序，或拆成单一所有者，不能靠同时编辑后解冲突。

## 交付、证据与集成

- 结束时汇报 `git diff --stat`、修改路径、行为变化、验证命令及结果、证据路径；大 diff 必须说明为何不可拆分，以及接口和生成文件变化。
- 可共享证据放已认领的 `docs/ds/evidence/<unit>/` 等路径；本地临时日志可放各 worktree `.audit/`，但必须提供绝对路径并交接，远程 agent 不应假定能访问本地日志。日志不得含凭据。
- 协调者将结论和证据索引写进 BOARD；失败的真实验证写 blocked，不把 mock 结果当作 Ark 已接通。
- 集成前对齐协调者指定 trunk。冲突时由任务所有者在自己的**未发布**任务分支 rebase trunk，重跑受影响验证；先保护未提交修改。若分支已推送，rebase 会改写已发布历史，须先说明影响并获得用户确认，不能擅自强推。
- 没有 commit 的交付保留在指定 worktree，列出 diff 及未跟踪文件供协调者收集；不擅自跨 worktree 覆盖文件。
- 重要决策追加本地 `.audit/ds-ide.tsv`（`ts/phase/decision/why/evidence/result`，tab 分隔；时间 ISO8601 `+08:00` / Asia/Shanghai），不能代替 BOARD 交接。

## 禁止事项

禁止 force-push main、擅自 push/提交、改无关文件、覆盖别人的未提交修改、共享构建输出、复制 Positron UI 源码进本仓。Ark MIT 也必须保留适用许可证/声明；新第三方来源与许可证先核实，再实施。
