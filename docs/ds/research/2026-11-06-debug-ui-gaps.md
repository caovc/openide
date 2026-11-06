# B2 调试界面的源码、恢复与暂停环境缺口

日期：2026-11-06；代码基线 `cb53d1b`。本次仅研究官方文档和已有代码，未实现 UI 或执行新的 runtime 验收。B1 已交付的 broker/双 cell 真运行不重复列为缺失；B2 的 kernel adapter 与 Notebook UI 仍在并行开发，下文是供合同采用的建议，不是已实现声明。

## 已核对来源

| 来源                                                                                                               | 本次核对到的事实                                                                                                 | 证据边界                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Jupyter messaging / debugInfo](https://jupyter-client.readthedocs.io/en/stable/messaging.html#debugInfo)          | 为前端重载/晚连接恢复 debugger 状态提供 isStarted、breakpoints、stoppedThreads；dumpCell 返回 sourcePath         | 协议文档不是特定 kernel 已实现每个字段的证据；已同时读取官方 jupyter_client main 的 docs/messaging.rst          |
| [JupyterLab debugger](https://jupyterlab.readthedocs.io/en/stable/user/debugger.html)                              | 支持调试源只读视图；变量跟随所选 frame，可选择 locals/globals；需支持调试的 kernel                               | 文档显示 JupyterLab 4.6.5，不推定 OpenIDE 已有相同 UI                                                           |
| [DataSpell notebook execution/debug](https://www.jetbrains.com/help/dataspell/running-jupyter-notebook-cells.html) | kernel/server 更换后依赖需重跑；Debug Cell 有跨 cell 源执行历史限制，编辑可能导致跳过 cell，调试时编辑可显示警告 | 打开的是 DataSpell 2025.3 文档，日期 2025-08-07；其后端限制不直接套用到我们的 B1 broker                         |
| [Positron R debugging](https://positron.posit.co/guide-r-debugging.html)                                           | 编辑使文件断点失效；断点可能移到合法行；frame 选择影响求值/变量，watch 随暂停和 frame 更新                       | 页面标 Positron 2026.11.0-308；只参考公开行为，不复制 ELv2 UI 实现，也不假设固定 Ark 0.1.252 支持所有页面新能力 |

直接 curl 部分官方站点被网络策略拒绝，已通过可用 web 连接器打开上述页面；DataSpell 猜测地址 debugging-code.html 返回 404，采用上表真实页面。以上是公开文档核验；下面的数据结构、恢复算法和测试是本仓设计建议。

## 当前可复用能力与缺口定位

`kernel/debug.rs` 已允许 debugInfo、dumpCell、source、threads、stackTrace、scopes、variables、evaluate；单一 control reader 和 bounded broker 已完成。host 有 token 校验、订阅 ready 与事件 sequence，lag 明确失败。`kernel_debug.rs` 已验证 Python/R 原 kernel 双 cell 断点、step/watch/continue、断开后同 PID 执行。

真实测试取得 dumpCell 返回 sourcePath，但没有证明同源码重复 cell、编辑后的历史版本、删除 cell、UI 重挂载时的 debugInfo 恢复。测试中的 debugInfo 只验证取消路径。B2 应补这些 UI 边界，不能把命令在白名单中等同功能完成。

现有计划已经要求稳定 cell ID/source revision 与歧义保留；本报告只细化三个会影响当前合同的切片，以及一个后续可视化入口。

## B2 必要：执行源码账本与歧义状态

建议映射为 `(documentId, token, sourcePath) -> SourceRevision[]`，记录 `cellId`、本地 revision/hash、提交给 dumpCell/execute 的精确源码、提交时间或执行序号。sourcePath 必须用 kernel 返回值，不自行拼临时目录或凭 debugInfo 的 hash 参数猜路径。源码快照应有大小/总量上限，超限保留“历史源不可用”而非无限缓存。

“已 dump”“已提交执行”“实际执行完成”分开：dumpCell 只创建调试源，不是函数定义已经进入 kernel；执行失败也可能已执行一部分，不能简单标记为从未生效。同一 cell 再次编辑不能覆盖旧 revision 的记录。cell 移动只改变显示顺序，不改变 cellId；删除后历史 frame 仍可指向原快照。

导航至少返回以下状态，不用 nullable path 混合表达：

- `current`：唯一可核对的候选，当前 cell 源与执行源匹配，可定位箭头。
- `historical`：源属于旧 revision 或已删除 cell，打开只读执行快照，标注历史版本。
- `ambiguous`：同一个 sourcePath 对应多个 cell，或执行元数据不足以区分；显示候选及只读源，不自动挑最新/第一个 cell。
- `external`：普通模块/包源，用 DAP sourceReference/source 或已验证文件读取；不要将 kernel 给出的路径直接当任意可读本地文件。
- `unavailable`：无法取源，仍保留栈、行号与继续能力。

同源码共享 sourcePath 时，setBreakpoints 是按 source 的完整断点集合操作：编辑/删除一个 cell 时不能发送空集合顺手删掉另一个 cell 的断点。对所有当前意图求并集；断点来源归属不明时显示共享/歧义，不伪造某一 cell 独有断点。采用 kernel 返回的 verified、message 和实际行号，编辑后 UI 清除该 revision 的已验证状态；是否保留旧 kernel 断点须按完整 source 账本决策。

最小测试：重复两 cell 同文本；定义 cell 执行后编辑但不重跑、再调用旧函数；移动和删除定义 cell；两个 revision 的旧函数对象同时存活；未验证断点被 kernel 调整行号；sourceReference 无文件路径。都应能继续执行且不会画错当前源码。

## B2 必要：重挂载恢复与 debugInfo

B1 的 ready 只说明当前订阅已建立，不代表历史 stopped 事件会重放。前端重挂载不能因没有收到新的 stopped 就把仍暂停的 kernel 显示为 running。

建议步骤：

1. 获取当前有效 NotebookKernelSession，建立事件订阅并等待 ready，保存 token 和恢复 epoch。
2. 同 token 查询 debugInfo，但不能把 isStarted 当跨 kernel 一致的 attached 标志。协调者与 Notebook owner 核对 Ark 的 `dap_jupyter_handler.rs` 第 353 行，发现其 debugInfo 在新会话也固定返回 isStarted=true；这是本批固定实现的源码差异，root 正在补真实 pre-init 探针。本轮冻结策略：Python 的 true 且前端无已知会话时拒绝自动接管恢复；Ark 的 true 单独不证明已 attach，只有 breakpoints/stoppedThreads 非空时拒绝未知现场接管。新 Ark 空状态允许走正常首次初始化。不得按泛化的 true 判定禁用全部 R 调试。未来完整恢复实现需依据固定版本实测区分未初始化、已连接及已暂停，避免重复 attach 或空断点覆盖。
3. debugInfo 在协议中不是原子事件快照，没有与 host sequence 对齐的 watermark。记录查询期间事件，不能让晚返回的旧快照覆盖更新的 continued/stopped。保守实现可遇事件交错便重新同步；持续变化时显示“同步中”并有界退出，不能声称完全无竞争恢复。
4. stoppedThreads 中的 thread 通过新 stackTrace/scopes/variables 重建；不持久化恢复 frameId/variablesReference。缺字段、success=false、超时、订阅 lag 应显示具体状态并禁用不可靠的操作；不要悄悄当全新会话清掉断点，也不要为了恢复自动重跑用户 cell。
5. token 变化即真正新会话：丢弃旧 frame/sourceReference/变量值及 verified 状态。用户断点意图和 watch 表达式可以保留，但须在新 source 映射与能力上重新验证；不能保留“已暂停”假象。

本切片的恢复范围是“host/kernel 仍活着时 UI 重挂载”；当前产品未据此承诺应用退出后进程持久化、远程 Jupyter 自动重连或跨 host 恢复。

验收：暂停后关闭/重开 UI 但保留 kernel；恢复查询期间 continued 到达；查询期间出现新的 stopped；旧 token 快照晚返回；debugInfo 不支持；事件订阅 lag；kernel 重启后相同文本仍有不同 token。若本轮不能完成恢复，B2 必须明确保留边界，不能显示可操作但无效的暂停工具条。

## B2 必要：暂停环境与异步结果的身份

暂停上下文建议至少包含 `{documentId, token, pauseEpoch, threadId, frameId}`，变量展开再带 variablesReference，watch 再带 expression revision。step/continue、切 frame、重启或关闭均使相应 pending 结果失效。仅比 token 不够：同一 kernel 连续两次暂停可复用数字 frameId，旧请求晚到会污染新暂停。

调试窗标题显示 Notebook/Console 身份及实际启动的 Python 路径或 R_HOME；不能跟随当前下拉框未生效的选择。未来 renv launchId 接线后显示已验证项目/profile，而不是根据 marker 推测 active。数据科学全局变量面板与暂停 frame locals 是不同视图；若复用必须显式标注上下文，不能把全局 df 当当前 frame 的 df。

watch/evaluate 使用当前 frame 的 debug 请求，不能走被暂停 shell 队列阻塞的普通 notebook execute；自动 watch 有执行副作用，应只在用户保存的表达式上刷新且有取消/上限。暂停时不要新增 shell 环境探针等待 R.home/sys.executable；显示启动时已有可信身份，额外 live 查询使用已验证的调试求值能力。

最小测试：内外两 frame 各自 x 不同，切换后 locals/watch 一致；慢变量展开在切 frame 后返回；continue 后旧 watch 返回；再次停止复用 frame 数字；切换活动 notebook 后原暂停会话仍可准确继续。断开调试与停止 kernel 分开，沿用 B1 的不 terminateDebuggee 合同。

## 后续小切片：暂停对象进入数据查看器

JupyterLab 公开 UI 可将暂停变量按表或富内容查看；本仓不要因此直接重用全局变量名字查询。新增最小桥接以暂停上下文和 variablesReference 定位对象，先支持结构化列表/表的有界展开；continue/step 后 viewer 标记失效，不能把旧引用用于新暂停。richRendering/copyToGlobals 是可选能力，B1 当前命令白名单也未开放这些扩展；另开协议 owner 验证后才启用，不在 B2 塞入伪按钮。

## 建议接续安排

B2 当前源码/生命周期 owner 先落实执行快照、歧义状态和 pause epoch；e2e owner 用 mockIPC 验证真实 React 接线与异步乱序，明确不代替 runtime 证明。debugInfo 恢复追加真实 Python/Ark 小探针；本轮先按上文冻结的 kernel 差异策略拒绝未知现场接管，完整恢复作为后续切片，缓存 token、断点意图与环境选择的持久化分别处理。生产 renv 激活仍按既有 launch 合同独立排期，不在调试 UI 工作树混改。

## 本轮集成验证补充

协调者已在 `kernel_debug.rs` 的真实 Python/Ark 用例加入初始化前 debugInfo 断言并通过：Python isStarted=false，Ark 0.1.252 isStarted=true，且新内核均无 breakpoints/stoppedThreads。B2 实际采用上述差异策略；完整恢复仍未实现。最终交付与验证边界见 [B2 报告](../evidence/ds04b2/REPORT.md)。
