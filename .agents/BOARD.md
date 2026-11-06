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

## 环境 P0 并行开发（2026-11-06，基线 80b97c7）

| unit               | status | owner                 | branch             | 独占路径 / 本次范围                                                                                                                 |
| ------------------ | ------ | --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| DS-01E1-probe      | done   | env_python            | ds/env-python      | crates/ide-sdk/src/python.rs：选定解释器只读诊断、真实双venv；root统一编译                                                          |
| DS-01E2-status     | done   | env_r                 | ds/env-r           | 新 crates/ide-notebook/src/environment.rs：只读renv项目状态，不启动/激活项目脚本                                                    |
| DS-01E0-ui         | done   | env_frontend          | ds/env-frontend    | notebook/**、ds-console/**、platform/runtimeEnvironment.ts、新ui/RuntimeEnvironmentDetails组件及tests/CSS；有效默认与显式选择不串用 |
| DS-04B-next        | done   | debug_protocol_review | ds/debug-next-plan | docs/ds/research/2026-11-06-next-slices.md；下一调试切片合同                                                                        |
| DS-env-integration | done   | Cloud Codex           | work               | host/sdk/notebook ops、Tauri薄命令/注册、notebook lib导出、生成bindings、catalog、集成测试/文档                                     |

接口冻结：sdk_python_environment(python绝对路径) -> PythonEnvironmentInfo；notebook_project_environment(near可空路径) -> RProjectEnvironment，host选择项目/所属workspace member根，不向父目录无限扫描。探针不安装依赖，R状态不报告active。前端新建Console继承有效Python默认，旧会话保持不变。共享类型由Rust生成；子agent不可手改bindings。

环境本批切片已完成集成验收，报告 `docs/ds/evidence/environments/REPORT.md`：真实Python双venv探针、R只读状态和host信任/项目根12测通过；bindings/严格clippy/标准类型/构建通过；前端全量6793通过，review修正后105相关测试通过；Chromium双视口4测通过。独立review发现默认/显式选择、跨项目迟到请求和renv措辞问题均已修复。整体DS-01E0–E4仍in_progress：renv实际激活、多R版本验证和完整统一环境合同尚待后续。

| unit    | status | owner       | branch | notes                                                                        |
| ------- | ------ | ----------- | ------ | ---------------------------------------------------------------------------- |
| DS-04B0 | done   | Cloud Codex | work   | 显式内核启动/协商，不执行用户cell；合同见 research/2026-11-06-next-slices.md |

## DS-04B0 显式内核启动（基线 26406df）

| unit                     | status | owner                  | branch                    | 独占路径 / 范围                                                                                                      |
| ------------------------ | ------ | ---------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| B0-kernel                | done   | kernel_start           | ds/kernel-start           | ide-notebook/src/kernel.rs、kernel/{transport,comm}.rs、新tests/kernel_start.rs；同generation启动句柄与取消/关闭竞争 |
| B0-host                  | done   | start_host             | ds/start-host             | ide-host/src/notebook.rs、ops/notebook.rs、新tests/notebook_start.rs；信任/admission/token与IPC注册                  |
| B0-ui                    | done   | start_frontend         | ds/start-frontend         | src/features/notebook/**、e2e/notebook-start.spec.ts；Start Kernel/取消，不执行用户cell                              |
| renv-activation-research | done   | renv_activation_design | ds/renv-activation-design | 新docs/ds/research/2026-11-06-renv-activation.md；独立临时R库真实探针，不改生产启动                                  |
| B0-integration           | done   | Cloud Codex            | work                      | Tauri薄命令/注册、bindings、catalog、集成验证、文档、提交推送                                                        |

接口冻结：KernelManager::ensure_started(path,runtime,cancel)->KernelComms；同runtime健康会话复用，不同活跃runtime拒绝。host notebook_start_kernel(id,selection,request)->NotebookKernelSession { id, token, selection, language }，token复用后端session generation，language为python/r，selection取实际runtime。启动复用admission且不修改文档execution_count或用户cell。仅显式启动新内核的取消会停止该启动，获取既有句柄不得杀已有kernel。root统一重型构建；renv启动改动待B0后串行接续。

B0分域交付已集成：真实Notebook82测通过；host启动Python6测及Ark1测通过；host既有Notebook10测通过（3项真实runtime默认忽略）；前端6805通过/6跳过；Chromium双视口2测通过。独立review发现取消获取误interrupt与busy覆盖均已修复。renv研究完成真实双项目隔离，IDE激活仍pending。完整证据见 `docs/ds/evidence/ds04b0/REPORT.md`；受影响三crate的all-targets严格Clippy、生成bindings、格式及diff检查均通过，本轮B0切片完成；原生GUI及完整调试仍按报告保留边界。

## DS-04B1 Jupyter 调试 broker（基线 2edb535）

| unit             | status | owner                  | branch              | 独占路径 / 范围                                                                                                     |
| ---------------- | ------ | ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| B1-transport     | done   | kernel_start           | ds/b1-transport     | ide-notebook/src/kernel.rs、kernel/**；单control reader、有界请求关联、能力快照与generation事件；先提合同再冻结     |
| B1-runtime-tests | done   | start_frontend         | ds/b1-runtime-tests | 新ide-notebook/tests/kernel_debug.rs；真实Python/Ark双cell断点/栈/变量/继续，等待合同后编写                         |
| B1-host          | done   | start_host             | ds/b1-host          | ide-host/src/notebook.rs、ops/notebook.rs、新tests/notebook_debug.rs；等待kernel合同冻结，token/订阅ready/信任/取消 |
| renv-followup    | done   | renv_activation_design | ds/renv-followup    | 新docs/ds/research/2026-11-06-renv-launch-contract.md；细化结构化环境与启动合同，生产transport待B1串行接续          |
| B1-review        | done   | b0_review              | read-only           | 独立协议及生命周期review；不修改源码                                                                                |
| B1-integration   | done   | Cloud Codex            | work                | Tauri接线、生成bindings、契约冻结、统一重型编译与验收、报告/计划、提交推送                                          |

本批先交付B1a/b/c后端协议闭环，不提前显示未经真实验收的Debug Cell。各agent从2edb535新建独立worktree，不覆盖上一任务未提交交付。重型cargo由root串行执行。

B1合同冻结：KernelComms提供debug_capabilities（generation/debugger/原始kernel_info）、同步debug_subscribe（generation与recv）、debug_request(command,arguments,cancel)返回原始DAP response。事件含generation、u32单调sequence、parent_id、原始content。control独立broker单reader，32 pending加32排队、10秒timeout、1MiB参数/8MiB响应、64KiB单debug事件和64项事件buffer；唯一msg_id+request_seq+command关联。每generation只允许Jupyter或ArkTCP一种调试transport，disconnect不释放transport身份，切换须restart；能力查询不占用。禁止launch/restart，disconnect不得terminateDebuggee/restart。

Host新增notebook_debug_capabilities(id,token)、notebook_debug_request(id,{token,command,arguments},request)、notebook_debug_events(id,token,request,onEvent)。事件订阅建立后发送{token,sequence:0,event:"ready",body:{}}，客户端收到ready才发送initialize；后续事件附同一token及sequence，lag明确失败。请求返回{token,response:原始DAP response}，保留success=false及initialize能力。旧Ark TCP API兼容，受新transport互斥约束。root接Tauri薄命令及生成bindings。

B1分域已验：真实Notebook91测（含Python/Ark跨cell断点、x41→42、watch43、同PID断开后执行）通过；host新合同Python3+Ark1通过；既有host Notebook13+R Console1通过；前端相关309通过，五套类型/生成bindings/构建通过。独立review推动事件内存上限与send前claim修正，Ark实测推动cellId元数据与threads unit wire适配。受影响三crate的严格all-targets Clippy通过，root完成集成；B2调试UI与renv生产激活仍pending，详见ds04b1报告。
