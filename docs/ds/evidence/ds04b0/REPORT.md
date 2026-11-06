# DS-04B0：显式启动 Notebook 内核

日期：2026-11-06；集成基线：`26406df`。实现和独立审查通过并行 worktree 交接，协调者统一生成 bindings 与运行真实验收。

## 行为与范围

Notebook 工具栏新增 **Start Kernel** 和稳定 action `notebook.startKernel`。显式选择 Python 或 Ark/R 后启动内核，不发送用户 cell 的 execute，不改变 source、已有输出、execution count、dirty 或历史状态。内部已有静默变量服务初始化仍保留，首个用户执行计数为 1。

`notebook_start_kernel` 经 host trust/RequestGuard/admission 返回实际 runtime 选择、语言及 generation-bound token。同 runtime 健康内核复用，另一个活跃 runtime 拒绝替换；获取已有 busy 内核句柄不影响执行。新启动在取消、IPC future 丢弃、关闭、重启、信任撤销时排空；半初始化进程不能被下一请求复用。跨文档、重启或关闭后的旧 token 验证失败。

UI 独立跟踪 starting，不把获取句柄回包误作 idle 事件；取消获取只取消该 request，不向已有 kernel 发 interrupt。启动时禁用运行、环境切换和结构修改。关闭/重启等待启动排空，迟到响应不恢复旧 handle。

## 验证

- 严格 Clippy：`cargo clippy -p ide-notebook -p ide-host -p openidea --all-targets -- -D warnings` 通过；`cargo fmt --all --check`、oxfmt 与 diff 检查通过。
- 生成绑定：`cargo test -p openidea --test export_bindings` 通过；Tauri 薄命令与 remote dispatcher 均已注册。
- `cargo test -p ide-notebook -- --include-ignored --nocapture --test-threads=1`：82 项通过，包含真实 Python/ipykernel 和 Ark/R、7 项新启动测试，以及变量、图表、LSP、数据探索、stdin、取消和重启回归。
- Host 新增测试 6 项（含真实 Python）通过；相同真实测试以 Ark/R 再运行 1 项通过。预存 sentinel cell、输出和 count=42 完整保留；首次执行 count=1；双已启动文档交叉 token 被拒绝；IPC 丢弃、restart/restrict 排空覆盖。初次测试误预期 PermissionDenied，按现有 Restricted Mode 的 Unavailable 合同修正并断言消息，生产信任边界未改动。
- Host 既有 Notebook 单元回归：10 项通过、3 项真实运行时测试默认忽略（本轮真实执行另由上述 kernel/host 集成测试覆盖）。
- 全量 Vitest：623 个文件、6805 项通过、6 项既有跳过；包括本轮启动/取消/busy/迟到响应回归与文本目录检查。
- 前端五套标准 `tsrs --noEmit` 配置通过；生产 `vite build`、oxlint、knip 通过（保留既有 warning/hint）。
- Chromium 桌面 1400×900 / 窄窗口 960×720：Start Kernel、状态事件、禁止执行/修改、取消获取 2 项通过。最初测试将按钮误写成 Interrupt，按现有可访问名称 Interrupt Kernel 修正后通过。
- 本机截图：`/workspace/work/b0-e2e-output/*/{notebook-before-start,notebook-start-ready}.png`，已检查窄窗口布局与未执行 cell。截图按仓库规则不提交。

真实运行时使用独立 `/workspace/work/ds-runtime`：Python 3.12.14、ipykernel 7.4.0、Ark 0.1.252、R 4.5.0。日志位于 `/workspace/work/b0-*.log`，不含凭据。

## 验证边界与后续

浏览器测试使用实际 React 界面和模拟 IPC/事件，只验证接线；真实进程行为由 Rust 集成测试独立验证。容器没有可用原生 Tauri GUI，未声称桌面原生端到端通过。

本批不提供 Debug Cell、断点、单步或 debugger broker。现有 NotebookKernel 状态事件尚无 generation/token；当前 UI 可拒绝迟到命令响应，但后续 B1 必须扩展事件合同并验证跨重启迟到事件隔离。

renv 双项目真实隔离研究单独交付，见 [研究报告](../../research/2026-11-06-renv-activation.md)；生产 IDE 尚未接入 `renv::load()`，只读环境状态不会报告 active。
