# DS 协作状态板

Canonical：`/workspace/openide/.agents/BOARD.md`；仅当前协调者 **Cloud Codex（本会话）** 更新。认领流程、路径所有权与交接格式见 [COLLAB](../docs/ds/COLLAB.md)。状态：`pending` / `in_progress` / `done` / `blocked`。

分支名为预留计划，不表示已创建。里程碑可 commit/push（防丢失）；未完成真实验证不得标 done。云端 Codex 交接：`docs/ds/HANDOFF-CLOUD-CODEX.md`。

基线上游 HEAD `ba9ce1d8`；工作树含 U1–U9.2a（未合入上游）。本会话按 COLLAB 使用独立 worktree 并行；基线 86113f6。

| unit   | status      | owner                     | branch                  | notes                                                                                                                                                                                                                                                     |
| ------ | ----------- | ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1     | done        | OpenIDE大师               | `ds/u1-ark-headless`    | VERIFIED：`ark_smoke` 得 42 + LSP completion `openide_smoke` + 无残留。证据 `.audit/u1-*`。未改 UI / r.toml。                                                                                                                                             |
| U2     | done        | OpenIDE大师               | `ds/u2-runtime-comm`    | VERIFIED：KernelRuntime Python/Ark + generation-bound comm API；证据 `.audit/u2-*`。                                                                                                                                                                      |
| U3     | done        | OpenIDE大师               | `ds/u3-kernel-select`   | VERIFIED：detect_ark + kernel Select；证据 `.audit/u3-*`。                                                                                                                                                                                                |
| U4     | done        | OpenIDE大师               | `ds/u4-ark-session-lsp` | VERIFIED：SessionLsp；证据 `.audit/u4-*`。                                                                                                                                                                                                                |
| U5     | done        | OpenIDE大师               | `ds/u5-ark-dap-stdin`   | VERIFIED：ark_dap + stdin；证据 `.audit/u5-*`。                                                                                                                                                                                                           |
| Java-A | done        | OpenIDE大师               | —                       | 软藏 VERIFIED：默认隐藏 JVM 语言/运行/调试/设置；`OPENIDE_JVM=1 VITE_OPENIDE_JVM=1` 诊断恢复。证据 `.audit/java-soft-hide.md` / `java-verification.tsv`。未硬删。                                                                                         |
| U6     | done        | OpenIDE大师               | `ds/u6-session-vars`    | VERIFIED runtime：共用 Variables/Plots；R+Python 真实会话隔离/重启清空；Python 7 + Ark 5 + session 3 + 前端 65 绿。证据 `.audit/u6-report.md` / `u6-verification.tsv`。GUI/截图未验；SAS adapter 接口已留。                                               |
| U7     | done        | OpenIDE大师               | `ds/u7-console`         | VERIFIED host/API：Python+Ark 真实执行保留状态=42、双 Console 隔离、stdin、restart/close、无 .ipynb、runtime 目录清空。前端 13 + host 10 单测绿。证据 `.audit/u7-report.md` / `u7-real-*-coord.log`。GUI/截图未验。U8 契约见报告 `ds.console.*` actions。 |
| U8     | done        | OpenIDE大师               | `ds/u8-editor-run`      | VERIFIED unit/DOM：选区/当前缓冲区 → 明确同语言 Console；picker/create、stale/mismatch/busy 拒绝、Stop；55 测 + typecheck 绿。证据 `.audit/u8-report.md`。原生 GUI/真实 Editor→kernel 未验（清单在报告）。                                                |
| U9     | in_progress | OpenIDE大师 / Cloud Codex | `ds/u9-data-explorer`   | U9.1 done；**U9.2a Ark smoke PASS**（`ark_explorer` ignored 测绿，broker=`crates/ide-notebook/src/ark_explorer.rs`）。待补 u9-2-report 与 UI/dbx 移植。交接见 `docs/ds/HANDOFF-CLOUD-CODEX.md`。dbx=t8y2/dbx。                                            |
| U10    | pending     | —                         | —                       | Windows SAS（后置）。                                                                                                                                                                                                                                     |
| U11    | pending     | —                         | —                       | Later：JVM 硬删除（阶段 B）。                                                                                                                                                                                                                             |
| U12    | pending     | —                         | —                       | Python / R 包可视化管理（能力差异分别支持）；R 另含包文档浏览。                                                                                                                                                                                           |

## Cloud Codex 当前批次（2026-11-06）

用户要求按已有计划多 agent 并行继续；本会话由 Cloud Codex 统一协调、集成。旧报告属于历史证据，当前基线含已提交冲突标记，必须复验。

| unit              | status      | owner           | branch              | 路径 / 验收                                                                                                                                                     |
| ----------------- | ----------- | --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U9.2a-rust-repair | done        | backend_survey  | `ds/u9-rust-repair` | `crates/ide-notebook/**`、`crates/ide-dap/src/lib.rs`（依赖中重复 module 导出阻塞编译）；修冲突和重复导出，相关单测、fmt、clippy；真实 Ark 缺环境则明确 blocked |
| U9.2a-ts-repair   | in_progress | frontend_survey | `ds/u9-ts-repair`   | `src/features/ds-data-explorer/ark.ts`、`ark.test.ts`；修冲突与契约边界，相关 vitest/typecheck                                                                  |
| U9-canvas-core    | in_progress | canvas_core     | `ds/u9-canvas-core` | 新 `src/features/ds-data-explorer/canvas/**`；独立绘制/滚动/Cell 映射，使用现有 contract；不激活生产 UI；测试                                                   |
| U9-integration    | in_progress | Cloud Codex     | `work`              | canonical BOARD、`docs/ds/**`、ENV.md、NOTICE、THIRD_PARTY_LICENSES.md；清理协调文档冲突、统一验收与证据                                                        |

## 后续批次：DS 产品目标与 U11（用户本会话明确授权）

目标：完整 Jupyter/Python/R 数据科学 IDE，尽可能覆盖 RStudio/Positron 工作流。用户已明确要求按 U11 硬剥离整个 JVM 工具链（Java/Kotlin/Scala/Groovy 等），保留非 JVM 与共用能力。

| unit              | status      | owner              | branch              | 路径 / 验收                                                                                                                |
| ----------------- | ----------- | ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| DS-build-recovery | done        | product_gap_review | `ds/build-recovery` | `src/features/build/**`、`src/features/coverage/**`；从匹配上游基线恢复缺失实现，不使用空占位；typecheck/build/consoleCopy |
| U11-plan          | in_progress | Cloud Codex        | `work`              | 前后端/语言资源只读拆分；待明确具体路径后并行认领                                                                          |

### U11 路径认领（串行分配后并行执行）

用户明确整个 JVM 工具链硬剥离；非 JVM 与通用 LSP/DAP/运行/构建必须保留。根 manifests/host/Tauri/core/生成 bindings 由协调者单写。旧配置可保留只读兼容类型，不能再执行 JVM 路径；不得静默删除用户配置。

| unit            | status      | owner             | branch             | 独占路径                                                                                                                                                             |
| --------------- | ----------- | ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U11-protocols   | in_progress | backend_survey    | `ds/u11-protocols` | `crates/ide-dap/**`、`crates/ide-lsp/**`                                                                                                                             |
| U11-frontend    | in_progress | frontend_survey   | `ds/u11-frontend`  | `src/**` 除 `bindings.ts`、`features/ds-data-explorer/**`（已接管恢复后的 build/coverage）；保留通用布局、Python/R、npm/Rust/Go等                                    |
| U11-languages   | in_progress | canvas_core       | `ds/u11-languages` | `crates/ide-language/**`、`crates/ide-syntax/**`、`languages/**`、`fixtures/java-app/**`、`fixtures/kotlin-gradle/**`、`fixtures/folding/regions.json`（仅语言列表） |
| U11-sdk         | in_progress | sdk_removal       | `ds/u11-sdk`       | `crates/ide-sdk/**`、`crates/ide-tools/**`、`java/**`                                                                                                                |
| U11-execution   | in_progress | execution_removal | `ds/u11-execution` | `crates/ide-run/**`、`crates/ide-build/**`、`crates/ide-workspace/**`、`crates/ide-profiler/**`                                                                      |
| U11-integration | in_progress | Cloud Codex       | `work`             | `crates/ide-host/**`、`crates/ide-core/**`、`src-tauri/**`、`crates/ide-android/**`、根 manifests/lock/scripts/CI/docs、生成 bindings                                |

| DS-feature-research | in_progress | product_gap_review | `ds/feature-research` | `docs/ds/FEATURE-BACKLOG.md`；基于公开来源持续调研并维护候选特性/证据/依赖，不宣称未验能力已完成 |

U9 当前批次与构建恢复验证证据：`docs/ds/evidence/u9-cloud/REPORT.md`（前端336测、Rust52测、typecheck/build通过；真实Ark与GUI仍未复验）。
