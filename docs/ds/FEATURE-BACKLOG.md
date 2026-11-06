# 数据科学 IDE 功能研究与候选开发队列

调研日期：2026-11-06（Asia/Shanghai）。第一版：官方资料 + 当前代码差距核查。本文是候选任务库，**不替代 canonical `.agents/BOARD.md` 的认领/进度**；由协调者选取任务、明确路径、分派实现。以下完成谓词是本项目拟定的验收，不是对竞品实现的复制或本仓已完成声明。

## 已确定的产品边界

- 面向 DataSpell 级工作流，完整支持 Jupyter Notebook、Python、R；尽可能覆盖 RStudio / Positron 的高频能力。
- 用户本会话明确要求 **U11 硬剥离整个 JVM 工具链**：Java、Kotlin、Scala、Groovy 等专属实现与资源退出；保留非 JVM 与共用 IDE 能力，避免删除通用 build、coverage、debug、LSP。
- R 使用 Ark 的公开 Jupyter/LSP/DAP 协议；Python 保留 ipykernel。竞品文档仅作为需求研究，不复制 Positron UI 源码。
- 使用现有 tokens、CSS Modules、actions、贡献点与中英文文本目录。跨 feature 通过 service/action 连接，生成 bindings 由协调者串行管理。
- 优先级：P0 = 基础可运行与数据工作流闭环；P1 = 日常完整体验；P2 = 扩展。P0 未验收不得用大量 P2 菜单代替。

## 本轮事实基线

1. `src/features/notebook/**` 已有原生 `.ipynb` 编辑、保存、执行、输出与 kernel 生命周期；`crates/ide-notebook/src/discover.rs` 有 Ark 环境发现。尚不能据此声称所有 Jupyter 行为完整。
2. `ds-console`、`ds-editor-run`、`ds-session` 已在 `src/features/index.ts` 激活；历史 U6–U8 报告仍明确原生 GUI 未验。
3. 数据探索存在 contract、fixture、Ark adapter 和当前新增 canvas 核心；尚缺生产 UI 激活、host capability 路由及 Python 表格 adapter。
4. `notebook/OutputView.tsx` 明确只支持静态 HTML，交互 widgets 尚不支持。`crates/ide-sdk/src/python.rs` 已有 venv/pip/uv基础，U12 不应重写为另一套 Python 包后端。
5. 全仓缺失 build/coverage 源码正在从精确上游恢复；云端原 Ark/R 安装缺失，历史 smoke PASS 不计为当前真实环境通过。

## P0：可直接分派的闭环任务

| ID / 优先级 | 用户工作流与当前差距                                             | 拟验收                                                                                                                                                            | 依赖与建议边界                                                                                                          | 官方研究来源                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DS-00 / P0  | 打开项目并运行应用；缺失 build/coverage、源码冲突阻塞整体门禁    | typecheck + bundle + 相关回归通过；真实应用可打开 Python/R项目；U11后无JVM专属入口或下载                                                                          | 当前恢复批次、U11；各自独立路径，协调者集成                                                                             | 本仓代码事实，不需竞品来源                                                                                                                                                                     |
| DS-01 / P0  | 选择明确 Python/R解释器并开始 notebook/Console；缺依赖能准确诊断 | 新项目选择两种环境；显示解释器/Ark/R实际路径与版本；缺ipykernel/Ark/R提示具体修复；切换/重启不串会话；禁止R失败静默回退Python                                     | `ide-sdk`、notebook discovery、环境UI；先真实runtime回归                                                                | [Positron 管理解释器](https://positron.posit.co/managing-interpreters.html)（见来源核验说明）                                                                                                  |
| DS-02 / P0  | notebook编辑→执行→保存→重开；补完整行为矩阵而非笼统“支持Jupyter” | code/Markdown/raw、metadata与未知MIME无损往返；Run Cell/All/Above/Below；排队/中断/重启/stdin/error/update_display_data；关闭后无本会话孤儿进程；Python+R真实样本 | `notebook/**` + kernel/document，分别分派UI与协议；复用现有实现                                                         | [JupyterLab notebooks](https://jupyterlab.readthedocs.io/en/latest/user/notebook.html)、[DataSpell notebook执行](https://www.jetbrains.com/help/dataspell/running-jupyter-notebook-cells.html) |
| DS-03 / P0  | 从会话变量打开真实 DataFrame、滚动查看、修改后刷新               | R data.frame + pandas DataFrame各一份；变量入口→表格页；列类型/缺失值/重复列名/大整数保真；多会话隔离；关闭/重启使旧句柄失效；不得用fixture作为生产数据           | U9 host capability/IPC、Python adapter、React viewport、canvas；先定接口再并行；`ds-session`入口由协调者接线            | [Positron Data Explorer](https://positron.posit.co/data-explorer.html)、[Variables pane](https://positron.posit.co/variables-pane.html)                                                        |
| DS-04 / P0  | 在 Python notebook与R脚本/Console断点、单步、查看栈和局部变量    | kernel能力协商后才启用；真实断点命中、继续/单步/退出、错误栈与源码位置正确；重启清理debug状态；不支持时明确说明                                                   | 复用 `ide-dap/session_dap.rs` 与 host notebook DAP；补debugger UI桥接；Python Jupyter Debug Protocol独立于R Ark adapter | [JupyterLab debugger](https://jupyterlab.readthedocs.io/en/stable/user/debugger.html)、[RStudio debugging](https://docs.posit.co/ide/user/ide/guide/code/debugging.html)                       |

## P1：日常数据科学体验

| ID    | 用户工作流与当前差距                                        | 拟验收                                                                                                                                                            | 依赖与建议边界                                                                                 | 官方研究来源                                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DS-05 | 数据探索排序、筛选、列摘要；当前capabilities明确unsupported | 全数据后端排序/过滤，不能只处理已加载页；类型适配与缺失值规则一致；统计注明dataset/filtered及精确/近似；百万行代表性fixture记录P95交互/内存阈值后实测；取消旧查询 | DS-03；TableProvider能力协商、R/Python后端适配先行；UI按capability启用                         | [Positron Data Grid](https://positron.posit.co/data-explorer-data-grid.html)、[Data Explorer](https://positron.posit.co/data-explorer.html)                                                                               |
| DS-06 | CSV/Parquet文件预览→导入当前R/Python会话→生成可复现代码     | 显示分隔符/编码/列类型预览；导入目标语言环境明确；真实变量与生成代码一致；大文件预览有界；文件不被意外改写                                                        | DS-03；独立文件provider+import actions，复用现有文件浏览器                                     | [Positron Import Data](https://positron.posit.co/import-data.html)                                                                                                                                                        |
| DS-07 | 项目包清单、安装/更新/移除、R帮助索引；U12仍设计阶段        | 清单显示实际解释器或R库路径；目标环境/包/源明确；执行日志和取消；操作后刷新；R帮助topic/index可浏览，示例运行必须明确触发                                         | 复用Python `ide-sdk` pip/uv，R新adapter；`ds-packages/**`和`ds-help/**`；协调者管理IPC/locales | [RStudio Packages pane](https://docs.posit.co/ide/user/ide/guide/ui/packages-pane.html)                                                                                                                                   |
| DS-08 | Python与R项目可复现环境；避免安装到错误全局库               | 检测pyproject/requirements/lock及renv.lock；显示当前环境与锁差异；R snapshot/restore真实测试；失败保留可诊断状态；不声称锁文件自动重现系统依赖                    | DS-01/07；R的renv与Python环境模型分开；显式操作不自动覆盖锁文件                                | [renv introduction](https://rstudio.github.io/renv/articles/renv.html)、[RStudio renv](https://docs.posit.co/ide/user/ide/guide/environments/r/renv.html)                                                                 |
| DS-09 | 在notebook中操作ipywidgets滑块/按钮，与kernel双向同步       | 真实IntSlider/Output/link样本；comm状态与buffer传输；多视图共享model；关闭/重启清理；缺模块给错误；不以允许任意notebook脚本代替widget协议                         | DS-02；comm broker与隔离renderer；依赖/license先核实；不破坏静态HTML安全边界                   | [Jupyter Widgets low-level protocol](https://ipywidgets.readthedocs.io/en/stable/examples/Widget%20Low%20Level.html)、[协议schema](https://github.com/jupyter-widgets/ipywidgets/blob/main/packages/schema/messages.md)   |
| DS-10 | R htmlwidgets/Plotly等交互图与通用Viewer                    | 真实R widget可交互；资源/链接可用；Viewer不暴露Tauri特权；跨项目与关闭后资源回收；静态输出仍可离线查看                                                            | U9 widget隔离方案；不可只把现有iframe sandbox放宽；与ipywidgets分别适配                        | [RStudio Viewer扩展](https://support.posit.co/hc/en-us/articles/202133558-Extending-the-RStudio-IDE-with-the-Viewer-Pane)、[RStudio panes](https://docs.posit.co/ide/user/ide/guide/ui/ui-panes.html)                     |
| DS-11 | `.qmd` / `.Rmd`分块运行→渲染→侧边预览                       | R/Python块使用正确runtime；Quarto CLI发现、渲染日志/取消、HTML预览；源文件与preview对应；RMarkdown用knitr路径；明确render过程与交互Console环境差异                | DS-01/02、隔离Viewer；新document feature；CLI非内嵌重写渲染器；visual editor后置               | [Quarto Positron工具指南](https://quarto.org/docs/tools/positron/)、[Quarto执行管理](https://quarto.org/docs/projects/code-execution.html)、[RMarkdown IDE集成](https://shiny.posit.co/r/articles/build/rmd-integration/) |
| DS-12 | 长R/Python脚本作为后台job，主Console保持可用                | 独立进程/环境/工作目录；stdout/stderr与状态、取消、退出码；错误定位；应用退出策略明确；无误杀其他会话                                                             | 复用run/task进程基础；新增DS jobs视图与adapter，避免共享交互会话阻塞                           | [RStudio Jobs](https://docs.posit.co/ide/user/ide/guide/tools/jobs.html)                                                                                                                                                  |
| DS-13 | 连接本地/远程Jupyter server并选择kernel                     | URL/token或支持的认证明确；列kernel/session、执行、中断、重连、关闭区分detach/shutdown；失败不泄露凭据；Python/R兼容kernel真实验收                                | DS-02；独立HTTP/WebSocket transport，保留当前本地ZMQ；项目与凭据存储边界                       | [DataSpell server管理](https://www.jetbrains.com/help/dataspell/configuring-jupyter-notebook.html)                                                                                                                        |
| DS-14 | Plots历史、选择/缩放/导出与R绘图尺寸重绘                    | Python matplotlib与R绘图真实显示；history与会话绑定；png/svg/pdf能力按后端声明；重绘不丢history；重启清理旧引用                                                   | 现有`ds-session` plots，后端format能力；静态与交互plot分开                                     | [Positron Plots pane](https://positron.posit.co/plots-pane.html)（见来源核验说明）                                                                                                                                        |

## P2：在基础闭环后扩展

| ID    | 用户工作流                                   | 拟验收与依赖                                                                                                                       | 官方研究来源                                                                                                                                                                                             |
| ----- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DS-15 | Shiny应用启动/停止、Viewer预览、日志与reload | 独立应用进程和端口所有权；真实R Shiny样本；停止释放端口；不对用户网络自动发布。依赖Viewer与jobs                                    | [RStudio Jobs in action](https://docs.posit.co/ide/user/ide/guide/tools/jobs-in-action.html)                                                                                                             |
| DS-16 | R包开发：模板、document/test/check、帮助预览 | 最小真实R包生成→roxygen文档→testthat→R CMD check报告；命令和目标环境准确；不移植GPL/ELv2 UI源码。依赖DS-07/12                      | [RStudio Writing Packages](https://docs.posit.co/ide/user/ide/guide/pkg-devel/writing-packages.html)                                                                                                     |
| DS-17 | 数据连接浏览、表格预览、生成Python/R连接代码 | 先支持现有非JVM数据库后端；schema/table浏览与有界预览；生成代码可运行；凭据引用不明文落入notebook。依赖DS-03与现有database feature | [Positron Data Connections](https://positron.posit.co/data-connections.html)、[使用连接](https://positron.posit.co/using-data-connections.html)                                                          |
| DS-18 | Notebook可读diff、清理输出、导出HTML/script  | cell级改动可读、metadata保真；导出与执行分离；缺nbconvert等依赖准确提示；不把普通JSON文本diff等同notebook结构diff                  | [DataSpell notebook编辑](https://www.jetbrains.com/help/dataspell/editing-jupyter-notebook-files.html)、[JupyterLab导出](https://jupyterlab.readthedocs.io/en/stable/user/export.html)（见来源核验说明） |
| DS-19 | 数据清理操作生成可复现代码，而非隐藏修改df   | 至少rename/filter/missing-value规则；预览前后差异与语言；生成代码明确由用户执行；撤销不误称运行时事务                              | [DataSpell Data Wrangler](https://www.jetbrains.com/help/dataspell/work-with-data-wrangler.html)                                                                                                         |
| DS-20 | R/Python跨语言reticulate工作流               | 明确Python来源与R会话关系；真实双语言交换样本；环境切换失败可恢复；不可将两个独立Console冒充共享对象                               | [Positron Reticulate](https://positron.posit.co/reticulate.html)（见来源核验说明）                                                                                                                       |

## 下一批建议切分

1. **当前主线**：DS-00/U11收敛 + 恢复真实Python/R测试环境；继续DS-03可用闭环，不分散到所有P2。
2. **并行A / runtime**：Ark explorer生产capability、生命周期、Python表格adapter；共享notebook模块由单一所有者或串行交接。
3. **并行B / UI**：基于已固定TableProvider的React viewport、可访问DOM、分页取消；变量入口/activation/locales由协调者集成。
4. **并行C / 独立功能**：先做DS-07包清单与R帮助只读切片，复用Python现有能力；与U9后端互斥路径先协议后认领。
5. **并行D / 验证**：真实Python/R notebook→Console→变量/plot→DataFrame闭环、环境切换/重启/双会话与GUI证据；测试结果决定done，不用UI截图代替协议验证。

## 来源核验与研究节奏

本轮通过可用网页搜索连接器检索官方域名，未遇访问阻塞。直接打开核验：Positron Data Explorer、DataSpell server管理、JupyterLab debugger、Jupyter Widgets low-level、RStudio Packages/Jobs、Quarto Positron、renv introduction。其他来源为官方搜索结果摘要与页面目录确认，涉及的候选尚需在认领时打开精读并固定协议/工具版本；标注“见来源核验说明”的具体页面URL仍需下一轮验证，不能据此承诺已支持。

后续研究每轮只提交有新增价值的差异：新候选/优先级变化/精确验收/已排除项/来源变更。每条向协调者报告可独立分派的路径与前置条件；不无限新增未排序菜单，也不在研究文档中擅改BOARD状态。当前阶段不把AI助手、团队协同、发布平台绑定列为P0；它们不能替代本地Python/R/Jupyter可用性。

## 第二轮：Python / R 调试与 Notebook 阻塞（2026-11-06）

本节替代 DS-04 的粗粒度分派；只读核查对象为当时主仓 `/workspace/openide`，不是研究 worktree 的旧代码。未编译、未运行 debugger、未进行 GUI 验收。第一轮事实基线是历史快照：build/coverage 已恢复，U11 正在集成，不能继续作为当前缺失项报告。下面“已有”仅代表读到实现或测试，**不等于本轮运行通过**。

### 四条调试链路的证据与边界

| 工作流                              | 已有代码证据                                                                                                                                                                                                                                                                                                     | 具体缺口与能力条件                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python `.py` 脚本 / module / pytest | `src/features/debugger/launch.ts:debugpyLaunch` 将解释器、模块、参数及 uv/poetry 环境转换为 launch；`crates/ide-dap/src/adapter.rs`、`lib.rs` 连接 debugpy；已有通用断点/栈/变量 UI。`crates/ide-dap/tests/debugpy.rs` 为需要真实 debugpy 的 ignored 测试，缺包时还可能跳过。                                    | 不应重写一套 Python debugger。下一步验证选择的 DS Python 环境与脚本调试环境一致，补齐菜单入口或环境接线中实际发现的问题；测试发现/跳过不能当真实运行成功。脚本 launch 产生独立 debuggee，不应展示成当前 notebook kernel 的共享变量。                                                                                                                                               |
| Python Notebook                     | 本地 kernel transport 已有独立 control 通道；Notebook cell 使用独立 `CellEditor.tsx`。                                                                                                                                                                                                                           | 未找到通用 Python `debug_request/reply/event` broker、`dumpCell/debugInfo` 调用或 cell breakpoint UI。现有 control 调试代码是 Ark 的固定 stepping 转发，不是 Python debugger。`kernel_info_reply` 当前只作 readiness，未保留调试能力供 UI 判断。必须检查 kernel 能力：兼容 `debugger` 与新协议 `supported_features`，ipykernel 6+ 是官方示例起点，版本本身不代替能力响应。[D2][D3] |
| R `.R` / Console                    | `kernel/comm.rs:ark_dap` 开 `ark_dap` comm，接 `server_started` loopback TCP 端口；`ide-dap/src/session_dap.rs` initialize/attach 到同一 Ark，没有启动另一 R。`ide-host/src/notebook.rs:dap/dap_events` 提供 generation 检查与命令白名单。`ark_smoke.rs` 包含 source 文件、断点、栈、变量、evaluate、next 流程。 | 前端 notebook/Console 尚未消费这两个 DAP API；通用 debugger session 与 notebook document/session ID 不同，须桥接。initialize 能力目前未保留，不能假定条件断点、异常过滤等都支持。事件订阅必须先于可能暂停的执行。普通编辑器断点必须在 source/运行选区前同步；暂停帧求值不能排进被阻塞的普通 execute 队列。                                                                         |
| R Notebook                          | 同一 Ark DAP 已可服务 notebook 所属进程；`kernel/transport.rs:dispatch_comm` 将固定 browser stepping 命令转 control，请求可在 notebook shell 忙时到达；启动使用 `--session-mode notebook`。                                                                                                                      | source(`debug.R`) smoke 不是 cell 调试。缺 cell 身份、执行源/行号映射、暂停位置装饰及 Debug Cell 入口；现有 host 白名单未包含 `dumpCell/debugInfo`，也不能据此推断 Ark 应沿用 Python 的全部扩展。需先探测固定 Ark 版本的源引用/执行元数据协议，不能拿临时脚本重新运行来冒充原 cell 调试。                                                                                          |

R 路径限定为 **Ark 的 DAP/Jupyter 集成**，不是 VS Code RDebug，也不以安装另一个 R 调试扩展替代。官方 Positron 2026.05 发布说明明确提供 R notebook 断点和 Debug Cell；当日 Ark README 仍写断点尚缺，二者不一致。故记录 Ark 版本/构建来源、读取实际 capability 与 verified breakpoint 响应，并做真实样本后才对该版本宣称支持；不能把竞品新功能等同本仓已有。[D4][D5][D6]

### DS-04 可分派最小任务（全部 P0）

**DS-04A：Python 脚本调试闭环与解释器一致性。** 边界：`src/features/debugger/launch.ts`及其 tests、`crates/ide-dap/tests/debugpy.rs`；若发现 Python 环境接线问题，由 `ds-editor-run` / run owner 单独接入。复用现有调试器。验收：项目 `.venv` 安装 debugpy，以下文件第 3 行断点命中时 `x=41`，step 后 `x=42`，watch `x+1`，继续输出 42；记录 `sys.executable` 与用户选定路径一致；脚本参数、cwd 与环境变量各一项可读。缺 debugpy 显示具体解释器与修复入口；测试必须报告实际执行/跳过原因，不将 skip 计 PASS。[D1]

```python
def add_one():
    x = 41
    x = x + 1
    return x
print(add_one())
```

**DS-04B：Python Notebook 调试协议 broker + cell UI。** 先协议 owner 独占 `ide-notebook/src/kernel/**` 与 `ide-host/src/notebook.rs`，固定 `KernelDebugCapabilities`、请求/事件、session generation 与 source map contract；之后 UI owner 独占 `src/features/notebook/debug*`、`CellEditor.tsx`、`NotebookEditor.tsx`，借用通用 debugger 视图接口。通过 control 路由请求/回复，通过 IOPub 接事件，唯一 seq/parent 关联、取消与重启隔离；cell 源映射采用 kernel 返回的 sourcePath，不能硬编码 ipykernel 临时路径。验收：第一 cell 定义上述函数，第二 cell 调用；第一 cell 第 3 行断点能被第二 cell 调用命中，栈定位回第一 cell，局部变量/单步/继续正常；编辑/移动 cell 后无旧位置误命中；重启后旧 frame/变量句柄失效；无调试能力 kernel 给明确不可用状态。依赖 DS-01、DS-02；与 Ark transport 修改串行合并。[D2][D3]

**DS-04C：R 脚本 / Console Ark DAP UI 桥接。** 协议复用现有 host DAP；先增加能力/状态合同及稳定 session 标识，再由 UI owner 在 `src/features/debugger/session*` 新增 kernel session adapter，`ds-console` / `ds-editor-run` owner 连接入口；bindings 由协调者生成，不能并发修改。验收：同一 Ark/R PID 中 source 下方 `.R` 文件，在第 3 行暂停，局部 `x=41`，evaluate `x + 1` 得 42，next/continue 正常；Console 中 `debugonce(add_one); add_one()` 也触发 UI；改变选中栈帧时 watch 使用该 frame，停止调试不会误杀另一会话。重启清空调试状态；无效断点显示原因，不伪造 verified。失败时保留实际 adapter 错误与 Ark 版本。依赖 DS-04B 的共享 UI 合同，不依赖其 Python transport 完成。[D4][D6][D7]

```r
add_one <- function() {
  x <- 41
  x <- x + 1
  x
}
add_one()
```

**DS-04D：R Notebook Debug Cell 与源映射。** 依赖 DS-04C 与 DS-04B 的通用 cell/source contract；一个 owner 先做真实 Ark 协议探针与测试，仅使用公开协议，不搬运 Positron UI 实现。边界：`ide-notebook/tests/ark_smoke.rs`、kernel execution metadata/source adapter，后接同一 notebook debug UI。验收：上述函数定义与调用拆成两 cell，断点停在原 notebook cell；编辑后断点重验证，移动 cell 仍按稳定 cell ID 归属，重复源文本的两 cell 不串位置，栈与 step 能回到正确 cell；不修改已保存 source、不把 notebook 自动另存为脚本；暂停时 continue/stop 可工作，关闭/重启清理。若固定 Ark 版本不能提供 cell 源关联，提交协议限制证据并保持能力禁用，不能用 source 文件 smoke 宣称此项完成。[D5][D6]

以上 A 与协议合同设计可并行；B/C 的 debugger UI 修改交给同一 owner，B/D 的 kernel transport 由同一 owner 串行处理。每项交付附 runtime 版本、实际执行命令/界面步骤、断点行/变量断言、事件日志与失败情形；“有测试文件”不作为完成凭据。

### Notebook 完整支持：仅追加三个关键切片

| 切片 / 优先级                                  | 只读证据与最小开发目标                                                                                                                                                                                                                                                                          | 真实验收与边界                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DS-21 / P0：Python cell 智能补全与帮助         | `CellEditor.tsx` 只为 R 注入 `arkLsp` completion/hover，Python目前只有语言语法；普通 `.py` LSP 不自动覆盖 notebook cell。先做同一 kernel 的 `complete_request` / `inspect_request`，返回坐标须处理 Unicode code point 与编辑器 UTF-16 差异；保留后续跨 cell 静态 LSP 扩展空间。[D2]             | Python cell 定义运行后下一 cell 可补全该变量/对象成员并查看函数帮助；中文/emoji 前缀插入位置正确；切换环境/编辑取消后旧结果不落回新 cell；busy 时可取消且不冻结输入。边界新增 notebook language adapter + kernel request broker；与 DS-04B 合同共用，由 transport owner 串行接线。                          |
| DS-02V / P0：已有执行/保存实现的真实互操作验收 | 已有 raw JSON span 保真、raw cell、attachments、stdin、clear_output(wait)、update_display_data reducer；不要重复报为全缺失。缺的是本轮可复核的跨 runtime 端到端证据。先建一个 Python 和一个 R 样本，包含未知 metadata/MIME、Markdown attachment、error 后队列、中断/重启、input取消与保存重开。 | 用本 IDE 与标准 Jupyter/nbformat交替读写，未知字段与输出保持；执行计数/排队状态正确，display_id 跨 cell 更新不串 notebook，stdin 密码不写日志，关闭后进程与pending请求可回收。边界已有 `document.rs` / `kernel_runtime.rs` / `session.test.ts` + GUI 验收脚本；只修实际失败，不新建平行 notebook 模型。[D2] |
| DS-09V / P1：交互 widget 最小闭环              | `OutputView.tsx` 仍明确 widgets unsupported、HTML iframe `sandbox=""`；即使已有 Ark comm服务，也不能推论已实现 ipywidgets model/view与binary buffer。先一个标准 IntSlider+Output，冻结协议/依赖版本与隔离renderer合同。                                                                         | 同一个 model 两视图同步，Python回调响应拖动，binary buffer正确，重启/关闭释放旧comm；保存重开有静态fallback或明确需要kernel的提示；禁止直接解除现有HTML隔离作为“支持”。边界 notebook widget broker + 新renderer；依赖 DS-02生命周期，不阻塞 A/C 的调试开发。沿用第一轮DS-09官方协议来源。                   |

### 第二轮核验来源

- **[D1]** [debugpy 官方 launch/attach 配置](https://github.com/microsoft/debugpy/wiki/Debug-configuration-settings)：已打开，脚本/module/python/cwd/env 配置参考；实际支持以固定 debugpy 版本为准。
- **[D2]** [Jupyter messaging 官方协议](https://jupyter-client.readthedocs.io/en/stable/messaging.html)：已打开并核对 kernel info、debug请求及扩展；当前文档协议版本5.5，文档版本8.10.0。`debugger` 字段已标deprecated，`supported_features`需兼容；这不是要求所有旧kernel升级为5.5。
- **[D3]** [JupyterLab debugger requirements/usage](https://jupyterlab.readthedocs.io/en/stable/user/debugger.html)：已打开；ipykernel≥6是其环境示例，启用取决于实际kernel支持。
- **[D4]** [Positron R debugging](https://positron.posit.co/guide-r-debugging.html)：已打开；脚本执行后的断点激活、编辑失效、栈/Console工作流供验收参考。
- **[D5]** [Positron 2026.05 release](https://positron.posit.co/release-notes/release-2026-05.html)：已打开；明确R notebook breakpoints/Debug Cell，用于确认产品能力方向，未复制其实现。
- **[D6]** [Ark 官方仓库 README](https://github.com/posit-dev/ark)：已打开；说明Ark包含Jupyter/LSP/DAP及source references，断点说明与[D4/D5]有时间差。猜测路径 `doc/dap.md` 返回404，`tree/main/doc`网页连接器访问受限；**没有取得独立完整Ark DAP规范**，精确cell执行元数据必须在实现探针中进一步核对，不在本计划伪造字段。
- **[D7]** [DAP 官方 overview](https://microsoft.github.io/debug-adapter-protocol/overview.html)：已打开；用于共同UI/adapter边界，Ark具体行为仍由自身响应与真实验收决定。

## 固定版本调试协议补充

研究复核见 [Ark 0.1.252 与 Jupyter 调试合同](research/2026-11-06-debug-capabilities.md)。固定 Ark 版本已有 Jupyter `dumpCell`/`debugInfo` 实现，因此 DS-04D 可复用 DS-04B 的 control broker，不必等待 DS-04C 的 TCP 桥；仍须本仓真实 cell 断点与源映射验收。重复 cell 文本产生同 sourcePath、UTF-8/UTF-16 坐标差异及 restart 能力声明不一致均列为测试边界。

## 环境支持优先提升（用户明确要求）

**DS-01E0–E4 / P0** 与 DS-04 调试并行：统一有效环境合同；Python venv 创建/发现/选择/依赖修复；R 版本与项目包库选择；renv 项目激活；运行/调试/Notebook/Console 环境一致性回归。项目默认、运行配置覆盖和会话覆盖必须明确，修改默认不改变已运行会话。Ark 当前 `--vanilla` 与 `.Rprofile` 激活的接缝需要显式解决，检测到 `renv.lock` 不代表实际激活。

**DS-08E1–E4 / P1**：Conda/Mamba、uv、Poetry 完整管理器接入和 renv snapshot/restore；**DS-07E** 将包操作绑定明确目标环境。验收包括双环境包隔离、实际解释器与库路径、跨子目录项目识别、重启恢复和缺依赖诊断。详细任务、源码证据及官方来源见 [Python/R 环境计划](research/2026-11-06-environments.md)。以上是开发计划，尚不能宣称完整支持。
