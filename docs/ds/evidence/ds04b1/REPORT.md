# DS-04B1：Python / R Notebook 调试协议

日期：2026-11-06；基线：`2edb535`。范围：后端 Jupyter 调试协议与 host 合同，不包含调试工具窗口或 Debug Cell UI。

## 实现

每个进程 generation 使用唯一 control reader 与独立 broker，idle 和正在执行/断点暂停期间均可处理调试请求。回复同时匹配 Jupyter parent msg_id、DAP request_seq 和 command；保留原始 success=false、message、initialize 能力。能力取自实际 kernel_info，兼容 debugger 与 supported_features，不凭 Python 包存在性或语言推断。

请求、事件与 host opaque token 绑定；订阅先建立 receiver，再发 sequence=0 的 ready，客户端收到 ready 后才能 initialize。后续事件使用本地单调序号，重启/关闭后旧请求、订阅和跨文档 token 不可使用。请求取消仅放弃本地等待，不声称取消内核内已生效的调试操作。

同 generation 的 Jupyter 与旧 Ark TCP DAP 互斥，切换 transport 需重启；旧 Ark comm stepping 共用 broker，不再竞争 control 读取。禁止 launch/restart；disconnect 不允许 terminateDebuggee/restart，确保共享内核可继续运行。

Ark Notebook 执行需要 metadata.cellId 才能关联 dumpCell 源路径。host 将文档中稳定 cell ID 传入窄接口 execute_cell_with_stdin，仅添加该元数据，不重写 source；原执行接口继续可用。Ark threads 使用 unit 参数，wire 将 {} 适配为 null，公共 API 仍要求对象。源路径由内核返回，不自行重算哈希；Ark frame 可能使用 file URI。

## 验证记录

验收使用独立运行时：Python 3.12.14、ipykernel 7.4.0、debugpy 1.8.22；Ark 0.1.252、R 4.5.0。真实断点样例为定义 cell 的 add_one（x=41，下一行加1），第二个 cell 调用。

轻量协议探针先确认两语言握手、断点和继续；正式 Rust 测试随后使用本产品 broker。初次 Ark 实测缺 cellId 时不暂停，补元数据后命中；首次 Rust 测试进一步发现 threads {} 被 Ark 拒绝，按其 wire 合同适配，未跳过该请求。

已完成检查：

- `cargo test -p ide-notebook -- --include-ignored --nocapture --test-threads=1`：91 项全部通过（含 7 项 broker 单测、2 项真实 Notebook 调试验收、旧 Ark TCP DAP/stdin/LSP、变量/图表/数据探索及启动生命周期）。
- 两语言实际暂停在定义 cell 第 3 行，locals x=41；next 后第 4 行 x=42，watch x+1=43；调用 cell 在暂停期间未提前结束，继续得到42；disconnect 后相同 PID 输出2；重启后旧请求和订阅失效，首用户执行计数为1。
- Host 新调试合同：3 项测试（含真实 Python）通过，真实 Ark 再运行 1 项通过；覆盖 trust、非法/取消请求不隐式启动、双运行文档 token 隔离、订阅 ready 与 initialized、重启后旧 token/订阅失效。
- Host 既有 Notebook 回归启用 ignored 真实用例：13 项通过（含 Ark LSP/stdin、Python Console）；R Console 单独再运行 1 项通过，同会话变量、输入、重启和关闭均保持。
- `cargo test -p openidea --test export_bindings` 通过，生成并提交新 IPC 类型；五套标准 TypeScript 配置通过。
- Notebook/debugger 前端回归：32 文件、309 项通过；oxlint、knip、vite build 通过（保留既有 warning/hint）。本批只改后端与生成绑定，未重复无关全量前端测试。
- `cargo clippy -p ide-notebook -p ide-host -p openidea --all-targets -- -D warnings` 通过；Rustfmt、oxfmt、diff 检查通过。

本机日志 `/workspace/work/b1-*.log`；源码回归测试随本提交保留。

## 明确边界

- 此批没有新增可见 UI，未做原生桌面 GUI 验收。B2 仍需共享 debug adapter、断点 gutter、cell/source revision 绑定和暂停定位，不能宣称已提供完整 Notebook 调试体验。
- 队列 32 与 pending 32 分别有界，最多合计 64 个请求；参数上限 1 MiB，单消息上限 8 MiB，默认等待 10 秒。畸形 reply 不误匹配，等待到超时。
- debug event 单项 64 KiB、broadcast 64 项，lag 显式失败。超限或畸形事件当前沿用 transport 错误路径停止 kernel；后续可隔离调试通道错误，以进一步保留计算状态。
- 新调试事件带 generation/token；既有通用 NotebookKernel 状态事件仍未升级，不能据此宣称所有事件已完全隔离。
- 同源码不同 cell 的 sourcePath 歧义、Unicode 编辑位置、源码编辑/移动后的 breakpoint revision 和调试 UI 仍需后续验收。未开放 Ark 声明但未验的 restart。
- renv 本批只交付结构化启动设计与官方能力补充：[启动合同](../../research/2026-11-06-renv-launch-contract.md)。IDE 实际激活待 transport 所有权释放后串行接入。
