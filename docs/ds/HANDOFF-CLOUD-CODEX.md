# OpenIDE → Cloud Codex 交接（2026-11-06，Asia/Shanghai）

本地 box 出口访问 ChatGPT/OpenAI API 被 Cloudflare 403，Codex CLI 不可用；用户改由**云端 Codex**继续开发。本仓已 push 到 `https://github.com/caovc/openide`。

## 产品目标（已定）

- Fork 上游 `l0ng-ai/openidea` → 数据科学 IDE（DataSpell / RStudio / Positron 工作流对标）。
- 主打：Jupyter / Python / R（Ark）运行调试、Console、编辑器 Run、共用 Variables/Plots、JetBrains 级数据探索。
- 用户 dbx = **https://github.com/t8y2/dbx**（Apache-2.0 Vue canvas），**不是** Databricks Labs CLI。
- Java：阶段 A 软藏（`OPENIDE_JVM` / `VITE_OPENIDE_JVM`）；阶段 B 硬删 = U11。
- 版本：自 fork 起 **0.1.0**（勿跟上游 0.1.37 混）。
- SAS（U10）后置：Windows COM → .NET → Tauri。
- R LSP/Jupyter：基于 Posit Ark，不自研。

## 仓库与环境

<<<<<<< Updated upstream
| 项           | 值                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| origin       | https://github.com/caovc/openide                                                                                 |
| upstream     | https://github.com/l0ng-ai/openidea（基线 commit `ba9ce1d8`）                                                    |
| 本地曾用路径 | `/workspace/openide`；Ark `/workspace/ark` @ `670a4946`（tag 0.1.252）；R `R_HOME=/workspace/mamba/envs/r/lib/R` |
| 工具链笔记   | `ENV.md`；优先 `source /workspace/tooling/env.sh`（若云端无此树，按 ENV 自备 Rust 1.96 + Ark 1.95）              |
=======
| 项 | 值 |
| --- | --- |
| origin | https://github.com/caovc/openide |
| upstream | https://github.com/l0ng-ai/openidea（基线 commit `ba9ce1d8`） |
| 本地曾用路径 | `/workspace/openide`；Ark `/workspace/ark` @ `670a4946`（tag 0.1.252）；R `R_HOME=/workspace/mamba/envs/r/lib/R` |
| 工具链笔记 | `ENV.md`；优先 `source /workspace/tooling/env.sh`（若云端无此树，按 ENV 自备 Rust 1.96 + Ark 1.95） |
>>>>>>> Stashed changes

**不要**默认 force-push；不要删用户未跟踪的研究仓。

## 单位进度（BOARD 为准）

<<<<<<< Updated upstream
| Unit                   | Status                                                 | 证据 / 说明                                                                                        |
| ---------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| U1–U5                  | done                                                   | Ark ZMQ/LSP/DAP/stdin；`.audit/u1-*` … `u5-*`                                                      |
| Java-A                 | done                                                   | 软藏；`.audit/java-soft-hide.md`                                                                   |
| U6                     | done runtime                                           | Variables/Plots；GUI 未验                                                                          |
| U7                     | done host                                              | Console；GUI 未验                                                                                  |
| U8                     | done unit/DOM                                          | Editor Run；原生 GUI 未验                                                                          |
| **U9.1**               | done                                                   | `TableProvider` fixture + 148 测；`src/features/ds-data-explorer/**`                               |
| **U9.2a**              | **runtime smoke PASS**（待写正式 report / BOARD 更新） | `crates/ide-notebook/src/ark_explorer.rs` + `tests/ark_explorer.rs`；见下方 smoke                  |
| U9 UI / dbx React 移植 | pending                                                | 计划 `.audit/u9-dbx-port-plan.md`、文件图 `.audit/u9-dbx-file-map.md`；源码参考可另 clone t8y2/dbx |
| U9.2b Python explorer  | pending                                                | 勿与 U9.2a 抢路径时并行写同一 broker                                                               |
| U10 SAS                | pending                                                |                                                                                                    |
| U11 JVM 硬删           | pending                                                |                                                                                                    |
| U12 包管理             | design only                                            | `.audit/u12-packages-design.md`；Python+R 差异都要；R 含包文档                                     |
=======
| Unit | Status | 证据 / 说明 |
| --- | --- | --- |
| U1–U5 | done | Ark ZMQ/LSP/DAP/stdin；`.audit/u1-*` … `u5-*` |
| Java-A | done | 软藏；`.audit/java-soft-hide.md` |
| U6 | done runtime | Variables/Plots；GUI 未验 |
| U7 | done host | Console；GUI 未验 |
| U8 | done unit/DOM | Editor Run；原生 GUI 未验 |
| **U9.1** | done | `TableProvider` fixture + 148 测；`src/features/ds-data-explorer/**` |
| **U9.2a** | **runtime smoke PASS**（待写正式 report / BOARD 更新） | `crates/ide-notebook/src/ark_explorer.rs` + `tests/ark_explorer.rs`；见下方 smoke |
| U9 UI / dbx React 移植 | pending | 计划 `.audit/u9-dbx-port-plan.md`、文件图 `.audit/u9-dbx-file-map.md`；源码参考可另 clone t8y2/dbx |
| U9.2b Python explorer | pending | 勿与 U9.2a 抢路径时并行写同一 broker |
| U10 SAS | pending | |
| U11 JVM 硬删 | pending | |
| U12 包管理 | design only | `.audit/u12-packages-design.md`；Python+R 差异都要；R 含包文档 |
>>>>>>> Stashed changes

### U9.2a 已通过的 smoke（复跑）

```bash
PATH=$HOME/.cargo/bin:/workspace/mamba/envs/r/bin:$PATH \
OPENIDE_ARK=/workspace/ark/target/release/ark \
R_HOME=/workspace/mamba/envs/r/lib/R \
cargo test -p ide-notebook --test ark_explorer -- --ignored --nocapture --test-threads=1
```

实测（暂停前）：`ark_view_schema_page_and_restart_rejection` **ok**（schema/page/NA·NaN·Inf 码、restart 拒绝旧 generation）。单元测试 2 个 helpers 亦绿。

前端映射：`src/features/ds-data-explorer/ark.ts` + `ark.test.ts`（对照 U9.1 contract）。

## Cloud Codex 建议下一刀（按优先级）

1. **固化 U9.2a**：补 `.audit/u9-2-report.md` / `u9-2-verification.tsv`，更新 `.agents/BOARD.md` U9 行；确认 `lib.rs` 导出干净；跑 format/clippy/相关 vitest。
2. **U9 canvas**：按 `u9-dbx-port-plan.md` 移植 `canvasDataGridRenderer`（Vue-free TS）→ React，接 `TableProvider`；勿整文件粘贴 `DataGrid.vue`。
3. **U9.2b**：Python DataFrame → 同 TableProvider。
4. **HTML widgets** 笔记：`.audit/u9-html-widgets-notes.md`。
5. **U12** 仅设计已有；实现排 U9 后。
6. 里程碑后 **commit + push**（用户要求防丢失）。

## 协作约定

- Canonical 状态板：`.agents/BOARD.md`；规范：`docs/ds/COLLAB.md`、`PRODUCT.md`、`ROADMAP.md`、`AGENTS.md`。
- 默认模型偏好（本地曾用）：`gpt-6.1-sol` 主力；最难协议可 `gpt-6-astra`；碎活 `gpt-6-luna`。
- 并行须路径隔离；勿动 `/workspace/ruoyi` 等其他工程。

## 已知坑

- 本地 Codex ChatGPT 登录/API 曾整站 403（与额度无关）。
- `.audit/` 原在 `.gitignore`；本交接 commit 会强制纳入**文档/报告**，排除 venv 与超大 log。
- plugin `*.wasm` 构建产物曾被删出工作树——云端需按上游方式重建 wasm，勿当业务删除。
