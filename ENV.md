# OpenIDE 本地环境

> 以下主体是首次搭建快照（Asia/Shanghai），部分限制已失效；当前状态见本节。**不要 push**。

## 云端本会话快照（2026-11-06，Asia/Shanghai）

- 当前 checkout：`/workspace/openide`，分支 `work`，基线 `86113f6`；origin 为 `caovc/openide`。
- Node `v24.22.1`，pnpm `11.25.0`；Rust 使用 `source /workspace/tooling/env.sh`。
- 旧快照中的 `/workspace/ark`、`/workspace/mamba/envs/r` 当前不存在。历史 Ark smoke PASS 不能算本环境复验；真实 runtime 验证待恢复依赖。
- 本批次正在修复基线中已提交的 U9 Rust/TS 冲突，并开发独立 canvas 核心；结果见 `docs/ds/evidence/u9-cloud/REPORT.md`。
- 以下为原环境历史记录，工具版本、路径与通过结果不代表当前云端状态。

## 原环境增量（2026-11-06，Asia/Shanghai）

- **U9.2a**：Ark `view`→`positron.dataExplorer` broker + ignored `ark_explorer` smoke 已通过；TS `ark.ts` 映射 U9.1 形状。Codex CLI 因 chatgpt.com HTTP 403 不可用，本地实现。

- U1–U4 已接通 Ark notebook 与会话 LSP；U5 接通 session DAP / stdin，验收见 `.audit/u5-report.md`。
- 重挂载后工具链恢复到 `/workspace/tooling`（所有安装写入仅在 `/workspace`）：先 `source /workspace/tooling/env.sh`；默认 Rust 为 1.96.0，Ark 按其 `rust-toolchain.toml` 使用 1.95（1.95.0）；不要仅依赖 `source ~/.cargo/env`。Linux Tauri 开发依赖现已安装，`pkg-config --modversion webkit2gtk-4.1` 为 2.54.0。客户端预览由协调者维护，不要按进程名批量终止。
- Ark：`OPENIDE_ARK=/workspace/ark/target/release/ark`，`R_HOME=/workspace/mamba/envs/r/lib/R`，`PATH=/workspace/mamba/envs/r/bin:$PATH`。
- DAP 必须开 **`ark_dap`**（非 `positron.ark_dap`），`server_started` 为 `data.method` / `data.params.port`；TCP initialize → attach。notebook 模式 step 委托 comm 的 n/s/f/c/Q 必须走 control `debug_request`，不能向被暂停 cell 占用的 shell 排队。
- Notebook host 现可回复/取消 stdin；KernelManager 原有非交互 API 仍 `allow_stdin=false`。提示与密码不写入 notebook。
- `cargo test -p openidea --test export_bindings` 已可运行，U5 IPC 用生成 bindings，不再手补。
- 真实 Ark 集成回归推荐 `-- --ignored --nocapture --test-threads=1`；并发启动的可靠性另见 U5 报告。

## 仓库

| 角色     | URL                                 | 说明                            |
| -------- | ----------------------------------- | ------------------------------- |
| origin   | https://github.com/caovc/openide    | 用户空仓目标远程（未 push）     |
| upstream | https://github.com/l0ng-ai/openidea | 上游框架，工作树已对齐其 `main` |
| 本地根   | `/workspace/openide/`               | 共享 box 固定路径               |

- 当前上游 commit：`ba9ce1d8` — `fix(workspace): unify nested project discovery and run ownership (#1716)`
- 分支：`main`（跟踪内容来自 `upstream/main`；origin 尚无对应提交）
- 工作树：仅未跟踪 `ENV.md`；构建产物 `dist/` 已在 `.gitignore`

## 产品方向（用户已定，实现未开始）

基于上游 OpenIDEA，保留核心 IDE 功能与界面，改造为 DataSpell 风格数据科学 IDE：

- Jupyter / Python / R：代码运行与调试
- 丰富数据探索
- 数据查看器可参考 Databricks / dbx 的 canvas 组件

## 技术栈（上游既定）

- 桌面壳：Tauri 2（Rust）
- 前端：React 19 + TypeScript + Vite + pnpm
- 语言配置：`languages/*.toml` + tree-sitter / LSP
- 包管理：pnpm；Rust workspace（`Cargo.toml` edition 2024）
- 要求：Node ≥ 22.18（见 AGENTS.md）

## 已装工具链版本（本机实测，2026-11-06）

| 工具   | 版本                      |
| ------ | ------------------------- |
| Node   | v24.22.1                  |
| pnpm   | 12.4.2                    |
| rustc  | 1.85.1                    |
| cargo  | 1.85.1                    |
| OS     | Debian 13 (trixie) x86_64 |
| Docker | 不可用 → 用本机进程       |

### Tauri Linux 系统依赖

- 已有运行时侧：`libgtk-3`、`librsvg2`、`libssl`
- **缺失（阻塞桌面启动）**：`pkg-config`、`libwebkit2gtk-4.1-dev`、以及常见的 `libayatana-appindicator3-dev` / `patchelf` 等开发包
- 原因：box 上 `apt-get update` 访问镜像（清华 / deb.debian.org）均失败（403 / 500，经 198.18.0.1），无法新装包
- 下次有可用 apt 源时建议安装：

```bash
sudo apt-get update
sudo apt-get install -y pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  librsvg2-dev patchelf libayatana-appindicator3-dev build-essential
```

## 依赖与验证

| 步骤                              | 结果                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| `pnpm install`                    | **成功**（~2.3s，lockfile 供应链策略通过）                        |
| `pnpm typecheck`                  | **成功**（tsrs 全配置无报错）                                     |
| `pnpm exec vite build`            | **成功**（~7.6s；有 chunk 体积 / 无效动态 import 警告，上游既有） |
| `pnpm tauri dev` / `pnpm dev:app` | **未跑**：缺 webkit2gtk/pkg-config；冷编译耗时长且产物大          |

## 启动命令（下次）

```bash
cd /workspace/openide
pnpm install                 # 已完成；换机或清 node_modules 后再跑
pnpm typecheck               # 前端类型快速门禁
pnpm tauri dev               # 推荐：worktree 隔离启动（需 Tauri 系统依赖）
# 或
pnpm dev:app                 # 额外启用全局 Tauri API（tauri.dev.conf.json）
pnpm dev:status              # 查看本 worktree 的 MCP bridge / 实际端口
```

### 端口 / worktree 注意

- **不要**直接 `pnpm exec tauri dev`：包装脚本会按 worktree 选 Vite 端口（占用则递增），并把真实 URL 交给 Tauri；HMR 走该 Vite 端口
- MCP bridge 端口动态范围约 **9223–9322**；用 `pnpm dev:status` 看实际端口，连接时显式传 `appIdentifier`
- 多 worktree 并行时各有一套会话；同 worktree 再开会复用已有 launcher

## 已知坑

1. **桌面冷启动**：`pnpm tauri dev` 会做完整 debug 编译，可能数分钟、磁盘占用大；迭代时不必反复 clippy
2. **本 box 暂不能编/启 Tauri UI**：缺 webkit2gtk + pkg-config，且 apt 源不可达
3. **pnpm 有更新提示**（12.4.2 → 12.18.0），非必须；当前锁文件可正常装
4. origin 仍为空远程：本地已有完整历史，**勿擅自 push**，等用户明确指示

## 与 DS 改造相关的现成能力摘要

### 语言层（`languages/`）

- **`python.toml`**：扩展 py/pyi/pyw；formatter ruff；LSP basedpyright（主）/ pyright / ty（fallback）
- **`r.toml`**：扩展 r / rprofile；LSP 经 `R --no-echo -e languageserver::run()`；**无独立 Jupyter/R kernel 封装**
- **无** `jupyter.toml` / `ipynb.toml`：notebook 走独立 feature，不是单纯语法语言表

### Notebook（已有，偏 Python kernel）

- 前端：`src/features/notebook/`（`NotebookEditor`、`CellEditor`、`OutputView`、session/security）
- Rust：`crates/ide-notebook/`（`.ipynb` 文档模型 + `KernelManager`，基于 jupyter_protocol / ZMQ，**按 Python 解释器路径拉起 kernel**）
- Host/命令：`crates/ide-host/src/ops/notebook.rs`、`src-tauri/src/commands/notebook.rs`

### Python 调试

- `crates/ide-dap`：内置 **debugpy** 适配器（可托管私有拷贝 / 一键安装提示）

### 数据库 / 表格 / 探索雏形

- `src/features/database/`：数据源、SQL、结果网格 `Grid`/`DataView`/`ResultsView`、`TableEditor`、`ChartView`、导出等（偏 DB IDE，可作数据探索底座）
- 官方插件 `plugins/official/csv-editor`：CSV 编辑
- `src/features/viewers/`：图片 / Hex / Markdown 等，**尚无** DataSpell 式 DataFrame / dbx canvas 查看器

### 缺口（相对目标产品）

- R：语法 + languageserver 配置有，**无** notebook R kernel / 专用运行调试流水线
- 数据探索 / DataFrame / Databricks-style canvas：**未实现**，需新建或外接组件
- 产品定位仍是通用 IDE；DS 专精 UI/工作流尚未裁剪

## 下一步建议（不改代码前的协作点）

1. 修好 apt 或换可用镜像 → 装齐 webkit 等 → `pnpm tauri dev` 验证上游 UI 可起
2. 与用户确认 DS MVP 边界：先强化 Python+Jupyter，还是并行 R；数据查看器是否直接嵌 dbx canvas 风格组件
3. 在 fork 上开分支做 DS 改造；保持 upstream remote，便于跟进上游修复
4. 本文件仅环境记录；产品决策与实现另开议题

## 变更记录

- 2026-11-06 16:00+ Asia/Shanghai：`upstream` 拉取并对齐 `ba9ce1d8`；`pnpm install` / `typecheck` / `vite build` 通过；Tauri 系统依赖因 apt 不可达未装；重写本 ENV.md
