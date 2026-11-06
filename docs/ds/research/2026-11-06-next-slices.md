# 环境诊断之后：可立即分派的 Notebook 调试切片

日期：2026-11-06（Asia/Shanghai）。只读核查基线为 `80b97c7`；本文件补充既有 [调试协议研究](2026-11-06-debug-capabilities.md) 和 [环境计划](2026-11-06-environments.md)，不重复整套协议设计。未实现或运行这里提出的 B0/B1 功能，不能记为调试验收通过。

## 新发现：首次 Debug Cell 之前还缺一个启动入口

`KernelManager::execute_with_stdin` 在 `crates/ide-notebook/src/kernel.rs` 中创建 slot、启动 `Running`、等待 ready、发布 `KernelComms`，随后立即执行传入源码。`comms()` 只返回已就绪的会话；当前 host DAP API 因而要求先执行过 cell。Notebook 的首次 Debug Cell 需要先获得能力、设置断点，再运行用户代码；不能把“先执行一次用户 cell”当作启动内核的办法，也不能为此添加可见的占位 cell。

因此下一批的第一步是 **DS-04B0：显式启动已有选择的内核，并返回 generation 绑定句柄**。它可以先于 Conda、Poetry、uv、renv 完整管理器交付。当前 `KernelRuntime::Python { executable }` / `Ark { executable, r_home }` 已足以启动已选环境；未来结构化环境描述可以拓展启动快照，不应成为整个调试器的阻塞项。

### B0 的精确边界

- 单一 owner 负责 `crates/ide-notebook/src/kernel.rs`、`kernel/transport.rs`、相关 runtime tests；host 接线涉及 `ide-host/src/notebook.rs`，由同 owner 或协调者串行合入。
- 抽出共用启动过程，例如 `ensure_started(notebook, selected_runtime, cancel) -> ready handle`（名称是提案）。执行路径和调试路径使用相同 slot、operation、stop、closed 检查；禁止另建一套 kernel 或在操作锁外直接启动进程。
- 启动本身不执行用户 cell、不修改 notebook 文档/outputs/execution_count；保留现有 `initialize_variables` 的内部静默初始化和其错误诊断，不要求完全没有内部 shell 请求。
- 对“已有相同 runtime 且健康”的会话只取得当前句柄；不能为了调试重启并丢变量。已有不同选择的会话必须经过显式会话切换流程，调试请求不能凭任意路径替换它。
- 启动取消/超时/失败沿用既有进程清理路径；close 与 startup 竞争时，不允许 ready 迟到后复活已关闭 slot。restart 产生新句柄，即便解释器路径没变，旧句柄仍须失效。
- host 向 UI 返回 opaque token；token 绑定实际运行会话，不能直接取 `EnvironmentDescriptor.id`、解释器路径或前端本地 generation 作为后端授权标识。

**B0 验收**：打开从未执行的 Python notebook，显式启动后首个用户 cell 的执行计数仍从 1 开始；再取句柄不换 PID、已有变量不丢；启动中取消/关闭不泄漏进程；同解释器 restart 后旧句柄拒绝；另一 notebook/Console 不受影响。Ark 路径同测，缺环境必须给出所选路径的错误而不回退 Python。新 API 的取消语义须写明：取消新启动与取消对既有会话的句柄请求不同，后者不能杀死既有 kernel。

## B1 必须先重构的接收结构

当前 `transport::Session::connect` 对 shell/stdin 执行 split 并建立统一有界 frame 队列，但 control 保持未 split 的连接；旧 Ark stepping 直接占用它。`supervise` 空闲循环和 `Session::run` 执行循环分别消费请求/事件。下一批添加 debug broker 时，两条循环都必须能调度 debug 请求、control 回复与 IOPub debug_event，否则首次连接空闲时正常、断点暂停后却可能挂起。

推荐交付顺序：

| 切片                    | 交付                                                                    | 独立验收                                                                                     |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **B0 启动/句柄**        | 抽出上述过程，无 debug UI                                               | 首次启动无用户执行、重复获取不重启、取消/close/restart竞争                                   |
| **B1a 消息分派**        | 单 control reader、请求ID/seq双重关联、IOPub事件分流、bounded pending   | 回复乱序、错误command/seq、超时迟到、idle/busy两态、旧generation事件拒绝；原Ark stepping回归 |
| **B1b Python真实协议**  | kernel_info能力快照、initialize/attach、dumpCell、断点/栈/变量/continue | 两cell函数调用、暂停中control响应、disconnect后kernel还能执行；不先做UI                      |
| **B1c host合同**        | token、订阅ready、受控命令/参数、generation校验、实际runtime显示        | token跨文档/重启拒绝，订阅不漏initialized/stopped，取消不会落到另一会话                      |
| **B2共享debug adapter** | 消费已冻结host合同，映射至现有栈/变量/动作                              | 保持脚本debugpy工作；kernel调试不伪造脚本process ID；随后才做Notebook cell入口               |

B0/B1a同一 owner 串行；纯 UI 状态模型可与协议测试并行，但不得提前直接调用尚未冻结的 IPC。renv 初始化若要修改同一启动路径，应在 B0 提取完成后接续，而不是两路同时改 `Running::spawn`。

## 固定 ipykernel 7.4.0 的新增约束

官方 tag `v7.4.0` 指向 commit `cfa461d8afac05cefc3671128d00adaa3c0720f4`（已用 `git ls-remote --tags` 核验）。本次读取该版本源码，不把源码中的行为当成本仓真实调试已通过。

1. **重复源码定位歧义也存在于 Python。** `dumpCell` 调用 `get_file_name(code)`；默认用 Murmur2 文本哈希和会话临时目录，重复代码返回同一路径。编译器也支持 `IPYKERNEL_CELL_NAME` 覆盖，进一步说明客户端不能自己重算路径。采用 kernel 返回的 sourcePath，保留一对多 source binding；不能只为 Ark 做消歧，也不能通过注入注释改变用户 cell 来“保证唯一”。[P1][P2]
2. **Jupyter attach 不等同裸 debugpy TCP attach。** ipykernel 的 `send_dap_request` 在 attach 流程中等待 initialized，并自行发送 configurationDone；外层 `configurationDone` handler 返回成功。通用客户端可以有自己的明确状态机，但不能假设必须额外再向裸 debugpy 连接发送一次配置完成才能收到 attach reply。用实际 Jupyter 消息测试固定顺序。[P1]
3. **包存在性不等于 Notebook 调试能力。** debugpy 顶层模块能被发现，仍可能 import/初始化失败。B1 从实际 kernel_info 能力开始，再处理 initialize 的 `success=false`；本批 Python probe 的 `debugpy` boolean 只作依赖诊断，不能直接点亮 Debug Cell。[P1][J1]
4. **调试会话恢复需要查询内核状态。** `debugInfo` 为稍后连接/重连的客户端提供状态。UI重新渲染不应重新 initialize、重新跑用户 cell；同一token下先恢复订阅并查询状态。kernel restart则不同：必须新token、重新协商。[J1]

## 本批 Python/R 环境接口兼容性复核

这些是代理已冻结的接口提议，不在本文件实现；最终字段以协调者生成的 bindings 为准。

| 接口                                                                                                                        | 可以服务什么                                                                   | 不能据此推断什么                                                               |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `PythonEnvironmentInfo`：executable/version/prefix/basePrefix、isVirtualenv、ipykernel/debugpy/pip模块发现                  | picker显示所选环境、缺依赖诊断、同base双venv身份核对；路径不canonicalize成base | 依赖可以成功import、kernel已启动、Notebook DAP可用、这是某个正在暂停的会话     |
| `RProjectEnvironment`：projectRoot、renvStatus、lock/activate/profile存在性、lockedRVersion/lockedPackageCount、diagnostics | 固定项目根的只读renv状态，明确detected-inactive与unavailable；与B0并行实现     | 当前R.home()/包库实际值、已执行activate.R、renv已active、应自动重启正在运行的R |

R接口只读固定项目根，不向父目录任意搜索；host负责选择正确 workspace member 根。`renv.lock` 里的R版本是锁文件声明，不能展示成当前运行版本。诊断刷新不改变 `KernelRuntime`、选择字符串或generation。

环境默认变化只影响之后解析的默认选择；显式 Notebook/Console 覆盖及正在运行的debug token保持绑定旧运行快照。只有用户显式切换该会话才失效旧调试/变量句柄。包安装可能改变下次启动能力，probe刷新也不能假装已加载模块在运行进程中自动换版。

## 来源与本次验证范围

- [P1 ipykernel 7.4.0 debugger.py](https://github.com/ipython/ipykernel/blob/cfa461d8afac05cefc3671128d00adaa3c0720f4/ipykernel/debugger.py)：读取 dumpCell、get_file_name调用、attach/init sequence、debugInfo与disconnect处理。
- [P2 ipykernel 7.4.0 compiler.py](https://github.com/ipython/ipykernel/blob/cfa461d8afac05cefc3671128d00adaa3c0720f4/ipykernel/compiler.py)：源码哈希文件名及IPYKERNEL_CELL_NAME覆盖。
- [J1 Jupyter messaging官方源码](https://github.com/jupyter/jupyter_client/blob/main/docs/messaging.rst)：本次读取control debug_request、dumpCell返回sourcePath、debugInfo重连用途及新旧kernel能力字段。main可变；实施验收固定实际内核版本。

仅进行代码/文档只读核查和Markdown格式检查；未改kernel/host/UI源代码、未编译Rust、未运行新调试流程。现有68项Notebook回归和双环境脚本debugpy通过是上一里程碑证据，不能替代本文件B0/B1的新增验收。
