# DS-04B2：Python / R Notebook 调试界面

日期：2026-11-06；基线：`cb53d1b`。本批由独立 debugger、Notebook、浏览器测试、官方特性研究和只读 review agent 并行交付，协调者统一集成与验证。

## 用户可用行为

Notebook 提供 Connect Debugger、Debug Cell 与每个代码 cell 的显式断点行输入。连接本身不执行用户代码；能力来自实际 kernel_info，订阅 ready 后才初始化调试器。断点显示 pending、verified、实际解析行或拒绝原因。

现有 Debug 工具窗口新增独立 kernel target，显示暂停栈、作用域、变量与用户添加的 watch，支持单步、继续和断开。kernel 使用文档/token 身份，不伪造脚本进程 ID；断开调试不停止计算内核。中英文文本目录随实现更新。

暂停及栈帧 epoch 丢弃旧变量/求值结果，后台 target 不抢当前暂停定位。明确的 DAP 拒绝会重新查询暂停状态；无法确认的传输失败显示状态不可用并禁用继续/求值，仍允许断开。初始化取消会清理已发送的请求；清理失败阻止同 token 盲目重连。

源码映射保存原始文本与内核返回路径，限制总量为 32 MiB；重复源码上的断点与歧义定位明确拒绝。修改、移动或历史恢复后断开调试并使旧映射失效。DAP 原始行列保持 1-based，Notebook 定位只转换一次行号，不猜测编码不同的列位置。

## 验证环境与结果

- 真实运行时：Python 3.12.14 / ipykernel 7.4.0 / debugpy 1.8.22；Ark 0.1.252 / R 4.5.0。
- `cargo test -p ide-notebook --test kernel_debug -- --include-ignored --nocapture --test-threads=1`：2 项通过，实际双 cell 断点、locals x=41、单步 x=42、watch=43、继续与断开后相同 PID 运行。新增初始化前 debugInfo 校验：新 Python isStarted=false，新 Ark isStarted=true，两者没有旧断点/暂停线程。UI 已按该差异处理。
- 前端相关回归：39 文件、388 通过、6 跳过，覆盖 Notebook、debugger、Services 和文本目录。全量初次执行 6832 通过、1 失败、6 跳过；失败由旧 Services 测试在设置 active 后覆盖手工 fixture 引起，已调整状态设置顺序并通过相关回归。最终全量重跑：625 文件、6833 通过、6 跳过，无失败（196.58秒）。
- 五套标准 TypeScript 配置通过，最终应用类型检查再次通过。严格 `cargo clippy -p ide-notebook --all-targets -- -D warnings` 通过。
- oxlint、knip、Vite 生产构建通过；既有 lint warning、knip ignore hint 和 bundle warning 保留。Rustfmt、oxfmt 与 diff 检查均通过。

## 浏览器 QA

环境为 Linux Chromium，实际 React 应用运行于 `http://127.0.0.1:1450`，分别测试 1400×900 与 960×720。本环境无可用 Tauri MCP，Browser 工具不可调用；沿用仓库 Playwright 用例验证。未进行原生 Tauri GUI 端到端验收。

`e2e/notebook-debug.spec.ts` 共 8 项通过，两个窗口尺寸分别覆盖：

1. Python 连接不执行、断点派发、Debug Cell、暂停栈/locals/watch/单步/继续、断开但不停止 kernel。
2. R 使用 isStarted=true、合法负 threadId=-1、frameId=0 与 file URI，完成相同交互。
3. 无调试能力时拒绝初始化和用户代码执行。
4. 重启后迟到的旧 token 事件不更新新会话。

检查包含正确项目/Notebook、非空页面、可交互控件、暂停定位、页面错误，以及桌面和紧凑截图目视检查。R 紧凑截图显示定义 cell 第4行、locals x=42、watch x+1=43，工具窗口布局正常。截图仅是 mock IPC 的 UI 证据，不能代替上面的真实内核协议测试。

本机证据（不提交二进制截图）：`/workspace/work/b2-before-output/` 为修改前 Start Kernel 页面，`/workspace/work/b2-e2e-output/` 为 Python/R 暂停和重启截图；日志为 `/workspace/work/b2-*.log`。可复现用例随提交保留。集成期间曾因 Vite 热更新重复模块造成服务未注册，重启稳定服务后通过；R 下拉框测试已改用实际自定义菜单而非原生 select。

## 尚未完成

- 目前每 cell 仅一个显式断点行输入；多断点 gutter、条件断点和异常策略未完成。
- 历史执行源码、重复源码精确区分与完整调试重连仍待后续。Python 已开始但未知的现场不接管；Ark 的 isStarted 常真仅在没有未知断点/暂停线程时允许初次接入。
- 编辑即断开是保守策略；没有实现编辑后不中断的源码迁移。文件导航等待期间可能先切换 tab，epoch 可阻止过时高亮，不能撤销已发生的 tab 激活。
- 本批真实协议测试与浏览器 mock IPC 测试分开执行，不能宣称真实桌面 UI 全链路已验。
- renv 生产启动激活、环境管理器全功能和暂停对象数据查看器仍未实现。后续按独立任务接入，研究与验收要求见 [调试 UI 缺口](../../research/2026-11-06-debug-ui-gaps.md) 与 [renv 启动合同](../../research/2026-11-06-renv-launch-contract.md)。
