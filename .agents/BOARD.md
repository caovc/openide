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
| U10    | pending     | —                         | —                       | Windows SAS（后置）。调研：**有条件可以**（非纯 WASM 插件）。推荐 host 托管 .NET COM 侧车。见 `docs/ds/SAS-PLUGIN-FEASIBILITY.md` + `SAS-PLUGIN-PLAN.md`。未认领实现。                                                                                    |
| U11    | in_progress | Cloud Codex               | work                    | JVM 硬剥离已集成；全workspace clippy、bindings、真实Notebook68测通过；最终回归与提交中，原生GUI未验                                                                                                                                                       |
| U12    | pending     | —                         | —                       | Python / R 包可视化管理（能力差异分别支持）；R 另含包文档浏览。                                                                                                                                                                                           |

## Cloud Codex 当前批次（2026-11-06）

用户要求按已有计划多 agent 并行继续；本会话由 Cloud Codex 统一协调、集成。旧报告属于历史证据，当前基线含已提交冲突标记，必须复验。

| unit              | status      | owner           | branch              | 路径 / 验收                                                                                                                                                     |
| ----------------- | ----------- | --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U9.2a-rust-repair | done        | backend_survey  | `ds/u9-rust-repair` | `crates/ide-notebook/**`、`crates/ide-dap/src/lib.rs`（依赖中重复 module 导出阻塞编译）；修冲突和重复导出，相关单测、fmt、clippy；真实 Ark 缺环境则明确 blocked |
| U9.2a-ts-repair   | done        | frontend_survey | `ds/u9-ts-repair`   | `src/features/ds-data-explorer/ark.ts`、`ark.test.ts`；修冲突与契约边界，相关 vitest/typecheck                                                                  |
| U9-canvas-core    | done        | canvas_core     | `ds/u9-canvas-core` | 新 `src/features/ds-data-explorer/canvas/**`；独立绘制/滚动/Cell 映射，使用现有 contract；不激活生产 UI；测试                                                   |
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

U11-protocols 扩展认领给 backend_survey：`crates/ide-host/src/ops/debug.rs`、`crates/ide-host/src/ops/debug/**`、`crates/ide-host/src/ops/lsp.rs`、`crates/ide-host/src/ops/nav.rs`、`crates/ide-host/src/ops/refactor.rs`、`src-tauri/src/commands/debug.rs`、`src-tauri/src/commands/lsp.rs`。协调者只集成注册与其他host文件，不并行编辑这些路径。

U11-editor 转交 product_gap_review：`src/editor/**`、`src/platform/classFiles*`、`src/platform/virtualDocs*`、`src/platform/filePresentation*`、`src/platform/projectPresentation*`、`src/platform/buildModel.ts`、`src/features/project-tree/**`。frontend_survey 释放这些路径；已做 languages.ts/JSP删除由新owner接续。FEATURE-BACKLOG 第一版21项已交付，后续继续分轮调研。

U11-sdk 扩展认领 sdk_removal：`crates/ide-host/src/project.rs`、`crates/ide-host/src/lib.rs`、`crates/ide-host/src/java_runtime.rs`、`crates/ide-host/src/kotlin_bridge.rs`、`crates/ide-host/src/bin/server.rs`、`crates/ide-host/src/ops/sdk.rs`、`crates/ide-host/src/ops/tools.rs`；清SDK/JVM生命周期调用与库列表接缝，保留Notebook关闭、通用LSP/PHP/project roots。root仅改其余host/core/Tauri/根清单。

U11-languages完成121项测试，扩展分配 canvas_core 负责 `crates/ide-core/**` 的JVM专属实现/类型清理和旧设置无损兼容测试；只保留必要只读历史数据，不执行JVM逻辑。root释放core，不与其重叠。

U11-protocols 再扩展 backend_survey：`crates/ide-host/src/ops/build.rs`、`crates/ide-host/src/ops/run.rs`、`crates/ide-host/src/ops/run/**`、`src-tauri/src/commands/build.rs`、`src-tauri/src/commands/run.rs`。与 execution_removal 同步被删API，保留非JVM构建/remote run并在启动前拒绝历史JVM配置。

U11-sdk 本轮实现已集成；sdk_removal 扩展负责 `.github/workflows/language-smoke.yml`、`smoke/**`、`crates/ide-host/tests/**`、`src-tauri/Info.plist` 的JVM专属测试/安装步骤/文件关联清理与非JVM回归保留。不得改其他CI/release脚本或生成bindings。

U11集成追加 root：`crates/ide-remote/src/target.rs` 移除Java专属解释器映射；保留Python/Node、通用远端命令与历史配置数据。

集成回归补充 canvas_core：`src/ui/icons.tsx`、`src/ui/icons.test.tsx`、`src/ui/openidea/**` 新DS图标、`src/features/ds-session/index.ts`、`src/features/ds-console/index.ts`，修复已有DS工具窗口图标重复及缺失SVG映射。frontend_survey释放这些具体路径。SDK agent只调查本地Tauri依赖sysroot，不修改仓库。

U11 root补充：删除官方JVM专属 `plugins/official/checkstyle/**`、`plugins/official/mybatis/**`，同步 `plugins/README.md`，保留插件宿主及其余官方插件。

## 继续推进：U11 验收与 DS-04A（2026-11-06）

| unit              | status      | owner            | branch                         | 独占路径 / 验收                                                                                                                                                 |
| ----------------- | ----------- | ---------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U11-cleanup       | done        | frontend_cleanup | ds/u11-frontend-cleanup        | smoke/debug.test.ts、debugger/breakpoints/{special,symbols}.ts、debugger/state.ts、run/buildUpdate.ts、`debugger/__tests__/codeLines.test.ts`；清残余 knip 引用 |
| DS-04A            | in_progress | debug_python     | ds/ds04a-python-debug          | debugger/launch.ts 及直接 tests、ide-dap/tests/debugpy.rs；真实 Python 解释器/断点/变量验收                                                                     |
| DS-debug-research | done        | feature_research | ds/debug-capabilities-research | docs/ds/research/2026-11-06-debug-capabilities.md；公开协议与下批合同                                                                                           |

旧代理本轮已退出，以上代理接续指定路径；主仓未提交集成快照为权威。其余源文件由 root 单写，重型 Rust 验证统一串行。

U11-cleanup 扩展：frontend_cleanup 独占 build/build.test.tsx、`debugger/__tests__/{actions,attach}.test.ts`、http-client/spring/**及直接消费者；清生成 bindings 揭示的 JVM 残留。

DS-debug-research 扩展：feature_research 独占 docs/ds/research/2026-11-06-environments.md；用户明确 Python/R 虚拟环境支持需提上计划，root维护BACKLOG/ROADMAP接入。

| unit       | status  | owner | branch | notes                                                                                                                           |
| ---------- | ------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| DS-01E0–E4 | pending | —     | —      | 用户新增核心要求：Python venv、R版本/包库/renv与统一环境合同；详见research/2026-11-06-environments.md；研究已交付，不等于已实现 |
| DS-08E1–E4 | pending | —     | —      | Conda/Mamba、uv、Poetry完整管理、renv snapshot/restore；P1                                                                      |

### U11 集成验收结论

JVM 工具链删除代码已集成；全workspace/all-targets clippy、自动生成bindings、五套TS类型、生产bundle与格式/knip通过。前端621文件/6779测试通过（6既有跳过）；真实Notebook68项全通过。13个Rust库834通过、3容器PID1僵尸进程断言失败、7忽略，证据见U11报告。U11保持in_progress直到原生GUI及独立平台验证完成；可以提交当前可审查里程碑，不宣称整套IDE已完成。

### 已提交里程碑与 DS-04A 进度

U11 集成里程碑：`8b6cc56`（提交含环境管理 P0/P1 计划与固定 Ark 调试协议研究）。DS-04A 增量修复 Windows/UNC Python 解释器解析；前端21测通过，两个真实Python venv各自debugpy断点/变量/单步/解释器验收通过。完整DS04A仍in_progress：GUI与统一环境选择接线待验，证据 `docs/ds/evidence/ds04a/REPORT.md`。
