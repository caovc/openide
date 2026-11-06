# DS-04B/C/D：调试协议与共享界面合同核验

日期：2026-11-06（Asia/Shanghai）。本次为官方协议/固定版本源码及主仓只读核查，**没有运行 Ark、ipykernel 或 GUI 调试验收**。研究不替代 BOARD，不新增一套调试器，也不把源码中的上游测试记作本仓通过。核查主仓为 `a0939dd` 加当前 U11 未提交集成修改；本文件只细化既有 DS-04B/C/D，不另建重复候选任务。

## 可以直接影响下一批分派的结论

1. **固定 Ark 0.1.252 已实现 Jupyter Debug Protocol。** 官方 tag 指向 `670a4946d8c3887e04591e4103b21fdba503afa3`，其中 `dap_jupyter_handler.rs` 处理 control 通道 `debug_request`，将事件发到 IOPub `debug_event`；明确实现 `dumpCell`、`debugInfo`、`configurationDone` 与 `evaluate`。因此 R Notebook 可复用 DS-04B 的 Jupyter broker；不必把 DS-04C 的 TCP/comm 桥作为它的 transport 前置条件。[A1][A2]
2. **上游有双 cell 断点测试，不只是 source 文件测试。** 同 tag 的 `test_notebook_breakpoint_stops_execution` 先 dump 定义函数的 cell，设置断点，attach，再通过带 `metadata.cellId` 的 execute 定义和调用函数；断点事件在函数体解析时变为 verified，暂停时 shell reply 未返回，control continue 后才完成执行。这给出可复核流程，但本 IDE 仍须自己运行并验收。[A3]
3. **不能把 sourcePath 当唯一 cell ID。** Ark `dumpCell` 用源文本哈希生成路径，相同源文本返回相同路径；路径还包含进程相关临时目录。映射必须允许一个 runtime source 对多个 cell/revision，且绑定 kernel generation。没有证据区分重复 cell 时应呈现歧义，不可自动跳到第一个 cell；这属于 DS-04D 完整验收的未解决条件。[A2][A3]
4. **Ark 的执行位置扩展不是本仓的坐标单位。** `content.positron.code_location` 是可选扩展，`range.character` 为 UTF-8 字节，行号从 0 起；本仓 IPC 是 UTF-16。若后续利用此扩展建立唯一虚拟源，须显式转换并验证，不能原样传编辑器列号；也不能假设任意 cell URI 已被 Ark 接受。[A4]
5. **能力响应仍须结合 transport 实测。** 同 tag DAP initialize 声明 `supportsRestartRequest=true`，但 Jupyter handler 的 Restart 分支只记录 unsupported；`debugInfo.isStarted` 固定为 true；`richRendering=false`。不能仅靠一个字段宣称 Notebook 原地重启调试或已经 attach。第一版继续使用已有 kernel restart 生命周期，rich variable rendering 不在该切片内。[A1][A5]

旧调研中“未取得 Ark 精确 cell 协议”现在可以由以上固定版本源码补足。Ark README 仍写缺少断点，其文字与同版本实现/测试不一致；采用版本固定的协议探针决定产品启用，不根据 README 或竞品发布说明单独判断。

## 本仓接缝：复用什么、缺什么

| 主仓路径                                      | 读到的事实                                                                                                                                                | 下一步最小变化                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `crates/ide-notebook/src/kernel/transport.rs` | kernel info 只用于就绪；现有 Ark stepping 桥发送固定 `seq=1`，直接读 control；执行输出按 parent 过滤；无通用 debug broker                                 | control 通道单一 owner；统一分发 debug replies、IOPub debug events、comm 和执行输出，不能新增第二个消费者争读 control |
| `crates/ide-notebook/src/kernel/comm.rs`      | `ark_dap` comm 可连接现有 R 进程 TCP DAP                                                                                                                  | 保留 Console/R 脚本路线；同一 generation 只启用一个调试 transport，避免重复 attach/重复事件                           |
| `crates/ide-dap/src/session_dap.rs`           | 连接时 initialize/attach；initialize body 被丢弃；连接成功后才可 subscribe；取消未完成请求会关闭 transport                                                | 保留能力；把“订阅就绪”变成显式握手；UI 必须能收到连接失效并清理，不把它等同 kernel 必须死亡                           |
| `crates/ide-host/src/notebook.rs`             | `dap` 只允 Ark，按 generation 检查，但 query/event 外部没有 generation/session token；白名单无 dumpCell/debugInfo/initialize/disconnect/configurationDone | 新合同由 host 统一验证，不只是扩大字符串白名单；回复/事件带 session token，客户端拒绝旧 generation                    |
| `src/features/debugger/state.ts`              | 通用会话键为数值 DebugSessionId；状态含 launch/process，工具视图和动作调用现有 debug IPC                                                                  | 增 adapter/service 边界；kernel 会话不伪造 process/runId，不复用整数碰撞；通用视图无需直接 import notebook feature    |
| `src/features/debugger/frames.ts`             | 非项目路径通常当 library frame；execution point 只含文件 path/line                                                                                        | cell frame 在路径折叠前解析为 notebook/cell 目标；保留真实 runtime source 作诊断，不能将所有临时源藏作 library        |

## 建议冻结的语言无关合同

下述名称为设计建议，不表示已有 API。协议 owner 先定 Rust/IPC 类型，再由协调者生成 bindings；UI owner 不手改生成文件。

- `KernelDebugSessionToken`：host 发放的不透明标识，唯一绑定项目、notebook/Console session 和 kernel generation。客户端不能指定或通过语言选择串接到另一内核。每次请求、事件、frame/variable handle 都关联该 token。
- `KernelDebugCapabilities`：transport 为 `jupyter-control` 或 `ark-dap-tcp`；保留 kernel info 宣告与 initialize 原始能力，另给验证后的可用能力及 unavailable reason。兼容旧 `debugger: true` 和新 `supported_features` 包含 `debugger`；协议字段未给时不按版本号臆测。[J1]
- `KernelDebugState`：`connecting / running / paused / disconnected / unavailable`，与 kernel execution busy/idle 分开。control 请求自身可产生 busy/idle，不能据此提前把暂停中的 cell 标为执行结束。
- `DebugSourceBinding`：token、document ID、稳定 cell ID、source revision、执行源码摘要、kernel 返回 sourcePath/sourceReference、行列转换策略；保存反向的候选 cell 列表。编辑后的 buffer 与暂停旧版本区分显示，不能把旧 frame 装饰到新代码。
- `DebugSessionAdapter`：向现有工具窗口提供 capabilities、threads、stack/scopes/variables/evaluate、breakpoints、step/continue、detach 和 source resolver。脚本 adapter 继续走通用 debug IPC，kernel adapter 走新合同；注册在既有贡献/service 层，禁止 feature 间直接引用。
- `KernelDebugEvent`：携带 token、单调本地事件序号、DAP event/body。订阅返回 ready 后才允许触发可能暂停的 execute；重连先建立事件订阅，再以 `debugInfo` 查询状态，合并去重。`initialized` 可能早于 initialize reply，必须缓存或先订阅。[A3]

### Broker 必须满足的边界

1. Jupyter header `msg_id` 与 DAP `seq` 分别唯一；用 `parent_header.msg_id` 和 `request_seq` 双重校验 reply，验证 command，不能使用“读到的下一个 control 消息”。IOPub `debug_event` 是会话事件，不要求其 parent 等于当前 execute。[J1]
2. 一个 generation 一个 control reader。旧 Ark `dispatch_comm` 的固定 stepping 也必须通过该 broker；否则接入 Python 时会互相抢回复。
3. 取消/超时从 pending 表移除，迟到 reply 不得写入新会话；restart/close 取消全部 pending、订阅、frame/变量句柄与 source bindings。若 adapter 不支持 DAP cancel，报告该请求的本地取消边界，不伪称内核执行已取消。
4. 包括 `debugInfo`、`dumpCell` 在内的请求采用受控命令集合、参数/响应大小限制；保留后端错误消息。`evaluate` 使用选中 frame，不能转发到被暂停占据的 shell execute 队列。
5. 初次流程为：订阅 ready → 能力判断 → initialize → 确认 initialized → adapter 规定的 attach/configuration → dumpCell/source binding → setBreakpoints → execute。initialize、attach、configurationDone 的精确握手由各 adapter 真实测试固定；不能把上游测试的省略步骤当通用规范。
6. 停止调试、执行中断、重启内核是不同动作。必须分别测试 disconnect 对共享会话存活的影响；只有用户的 kernel restart/close 走现有进程生命周期。初版不启用未验的 DAP restart。

## 可并行分派顺序

| 切片                          | 单一 owner 路径                                                                          | 交付与接续条件                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| B1：Jupyter broker + 能力合同 | `ide-notebook/src/kernel/**`、其真实/协议 tests；host 接线由同 owner 或串行移交          | Python + Ark 分别测 reply correlation、异步 event、暂停期间 control、取消/重启；保留已有 Ark comm/执行回归；通过后冻结合同            |
| C1：R 脚本/Console adapter    | `ide-dap/src/session_dap.rs` 与 host DAP 接线；若与 B1 host 路径重叠则串行               | 保留 initialize capabilities、订阅 ready、token、同 R PID；真实 `.R` source、debugonce、选帧 evaluate；不新增 R 进程                  |
| B2/C2：共用调试视图接线       | `src/features/debugger/**` 单一 UI owner；Console/Notebook 入口由协调者接贡献点          | 两类 adapter 共享栈/变量/手动 watch/toolbar，session targeting 正确；先有合同再改 UI，不让两 agent 同改 state                         |
| D1：R Notebook 协议探针       | B1 transport owner接续，新增真实 Ark notebook tests                                      | 使用固定 0.1.252 的 Jupyter 路线；核源映射、重复源码、Unicode、interrupt；不依赖 C1 TCP 功能完成                                      |
| B3/D2：Notebook cell UI       | 单一 Notebook UI owner，`CellEditor.tsx`、`NotebookEditor.tsx` 和新 debug/source adapter | 基于相同 source contract 接入 Python/R；编辑/移动/关闭清理；真实截图与跨 cell 导航；重复文本歧义未解决则明确限制，不能宣称 D 完整通过 |

可以并行的是 B1 的协议实现与 UI 的纯模型/组件工作、C1 的独立 DAP 能力保留；所有 host/kernel 合同变更先串行冻结。已有 U11 清理与 DS-04A 不需要等待本研究。

## 真实验收样例与必须保留的失败证据

两语言各建独立 notebook，在定义 cell 中输入下面函数，下一 cell 调用；断点设第 3 行。固定 interpreter、ipykernel/debugpy 或 Ark/R 版本，记录 sourcePath、verified 变化与事件顺序，不把代码存在或 ignored 测试发现计 PASS。

```python
def add_one():
    x = 41
    x = x + 1
    return x
```

```r
add_one <- function() {
  x <- 41
  x <- x + 1
  x
}
```

| 情形              | 可判定的通过条件                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 断点/单步/继续    | 调用 cell 暂停在定义 cell 第 3 行；locals x=41，next 后 x=42；选中 frame 的 watch x+1=43；continue 得42；shell执行在暂停时仍未完成        |
| R script/Console  | 同 R PID source 脚本后断点命中；`debugonce(add_one); add_one()` 也进入 UI；退出调试后 Console 还能执行1+1；不能误停另一 session           |
| 无调试能力 kernel | UI 明确不可用；正常执行保留；不发送未授权 dumpCell，不凭 runtime 名称启用                                                                 |
| 源码移动/编辑     | 移动只改变 cell顺序，稳定 cell ID 保持；编辑产生新 revision/映射并清除旧断点；旧 frame 用旧源码展示或显式标旧，不误定位新代码             |
| 同源码两个 cell   | 已知 Ark hash路径相同；探针需证实是否有足够运行标识消歧；不足时明确提示来源歧义，不能猜测。完整单 cell 断点隔离能力未证实时保持该项未完成 |
| Unicode           | 内容带中文/emoji；DAP↔IPC与可选Ark code_location坐标分别验证；断点与栈定位一致，不能将UTF-16列直接当UTF-8字节                             |
| 重启/取消/关闭    | 旧token和frame/变量句柄不可再用，迟到事件被丢弃；pending有界结束，另一notebook不受影响，内核进程按现有生命周期回收                        |
| 错误/能力不一致   | 记录实际 success=false/错误、请求command、版本；Ark Jupyter restart不因initialize声称支持便开放；无richRendering不显示伪富变量入口        |

## 来源与核验方法

以下官方来源于 2026-11-06 实际读取；只引用协议/行为，不复制 Positron UI 源码。Ark 本仓 MIT；本次未引入第三方实现代码。

- [J1：Jupyter messaging](https://jupyter-client.readthedocs.io/en/stable/messaging.html#debug-request)：读取官方 [messaging.rst](https://github.com/jupyter/jupyter_client/blob/main/docs/messaging.rst)，核对 control 请求/回复、IOPub debug_event、kernel info新旧能力字段、dumpCell/debugInfo；main可变，实施仍须真实版本探针。
- [A1：Ark 0.1.252 Jupyter handler](https://github.com/posit-dev/ark/blob/670a4946d8c3887e04591e4103b21fdba503afa3/crates/ark/src/dap/dap_jupyter_handler.rs)：扩展命令、事件路由、evaluate、restart限制。
- [A2：Ark 0.1.252 notebook source mapping](https://github.com/posit-dev/ark/blob/670a4946d8c3887e04591e4103b21fdba503afa3/crates/ark/src/dap/dap_notebook.rs)：文本哈希、临时目录、source位置构造。
- [A3：Ark 0.1.252 notebook integration tests](https://github.com/posit-dev/ark/blob/670a4946d8c3887e04591e4103b21fdba503afa3/crates/ark/tests/integration/dap_notebook.rs)：dumpCell、相同文本路径、initialize事件、双cell断点/继续、中断。阅读了测试，未运行这些上游测试。
- [A4：Ark 0.1.252 execute request schema](https://github.com/posit-dev/ark/blob/670a4946d8c3887e04591e4103b21fdba503afa3/crates/amalthea/src/wire/execute_request.rs)：可选Posit扩展、UTF-8字节坐标及跨度校验。
- [A5：Ark 0.1.252 DAP server](https://github.com/posit-dev/ark/blob/670a4946d8c3887e04591e4103b21fdba503afa3/crates/ark/src/dap/dap_server.rs)：initialize能力声明。
- [D1：DAP 官方协议 schema](https://github.com/microsoft/debug-adapter-protocol/blob/main/debugAdapterProtocol.json)：读取官方 JSON，作为会话/能力/断点/事件合同基础；不将可选能力当所有adapter必备。

复核命令：`git ls-remote --tags https://github.com/posit-dev/ark.git '*0.1.252*'`；`git show 0.1.252:<上述路径>`。本次研究仓为独立只读源码checkout，不与IDE运行/构建输出共用。
