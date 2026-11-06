# Python / R 项目环境：优先计划与真实验收

日期：2026-11-06（Asia/Shanghai）。用户明确要求把 Python、R 虚拟环境支持提上计划。本研究将其作为 **DS-01 的 P0 基础能力**，包安装/锁文件管理继续细分到 DS-07/08；不等 U9 数据探索完成才实现环境隔离。本文是代码/官方资料核查与可分派方案，未运行新环境管理功能，不能据此标完成。

## 产品语义与已有基础

Python 环境通常由一个解释器、`sys.prefix`、site-packages 和管理器组成；venv/virtualenv、conda、uv、Poetry 必须显示实际环境与来源。R 项目环境由 **R 版本 + 包库路径 + renv 项目/锁文件 + 启动配置** 组成。renv 隔离包库并记录依赖，不等于安装另一个 R，也不保证系统库和操作系统完全重现。[P1][R1]

Python 与 R 共用环境选择/状态界面，底层保留不同模型。切换项目默认只改变后续默认选择；正在运行的 Notebook/Console 继续保持自身环境，只有显式切换该会话才走其停止/重启流程。不能全局修改环境后悄悄重启或改变其他会话。

| 代码证据                                                                           | 已有能力                                                                                                                                              | 需要补齐                                                                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `crates/ide-sdk/src/discover.rs`                                                   | Python `.venv`/venv/env/.env、VIRTUAL_ENV、部分Poetry缓存、pyenv、uv安装目录、mise/asdf、常见conda根目录；venv按自身路径去重，避免symlink合并不同环境 | 管理器权威查询、非默认目录/自定义CONDA_ENVS_PATH、多平台缓存路径、超时/刷新/失效原因；不能把当前目录枚举称为完整Poetry/conda支持     |
| `crates/ide-sdk/src/python.rs`                                                     | 已可创建venv；对选定解释器用pip，缺pip时可用uv pip；不需重写另一套包后端                                                                              | 将创建/依赖修复入口与Notebook/Console选择连成闭环；展示安装目标，缺ipykernel/debugpy准确诊断                                         |
| `crates/ide-sdk/src/apply.rs`                                                      | 显式Python设置优先，随后项目或靠近文件的venv；运行、LSP、terminal已有部分应用逻辑                                                                     | 冻结统一解析优先级并对脚本/调试/测试/LSP验证；uv/Poetry/conda外部环境不要只修改PATH便称正确激活                                      |
| `src/features/notebook/session.ts`                                                 | 初始取sdkPythonEffective(null)，随后按notebook路径localStorage保存独立选择；会话可换kernel                                                            | 解释“项目默认”与“此Notebook覆盖”，显示有效环境；外部删除/移动后给可恢复失效状态，不能自动退回全局Python                              |
| `src/features/ds-console/**`                                                       | Console有独立runtime.selection，创建后固定，按语言路由                                                                                                | 新Console继承默认，已运行Console保持环境；Editor Run目标显示实际环境，不仅显示Python/R                                               |
| `src/features/run/runtimes.ts` → `producers.ts` → `debugger/launch.ts` → `ide-dap` | 脚本调试经运行配置/有效Python路径启动；与Notebook手动选项不同                                                                                         | 明确配置覆盖、项目默认、会话覆盖三者关系；不能声称Notebook选环境已自动改变脚本调试                                                   |
| `crates/ide-notebook/src/discover.rs`                                              | R选择为`ark\|<ark绝对路径>\|<R_HOME>`；发现OPENIDE_ARK/PATH和当前R_HOME或PATH的R                                                                      | 无多R版本清单、renv项目状态或包库描述；字符串模型不能完整携带项目环境，需结构化环境ID/启动描述并兼容旧选择                           |
| `crates/ide-notebook/src/kernel/process.rs`                                        | Ark用指定R_HOME，但以`--interactive --vanilla`启动，cwd为notebook所在目录                                                                             | **现状不能自动激活通常依赖项目.Rprofile的renv**；子目录notebook的cwd也不是项目根。先设计明确的项目环境初始化，不能仅显示“renv已启用” |

R 启动手册说明 `--vanilla` 包含 `--no-init-file`，而 renv 通常用项目 `.Rprofile` 加载 `renv/activate.R`。[R1][R2][R4] 不应为此全局删除所有启动隔离参数；应按已有项目信任机制，提供明确的普通R/项目renv启动模式，绑定项目根，完成受控初始化后查询实际 `.libPaths()`。未受信项目沿用现有限制，环境探测不执行任意项目脚本。

## P0：与调试并行推进的可分派任务

| 子项                          | 边界与实现目标                                                                                                                                                          | 真实完成谓词                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DS-01E0：统一有效环境合同** | SDK/runtime owner先定义项目默认、run配置覆盖、Notebook/Console会话覆盖与来源；结构化EnvironmentDescriptor/ResolvedEnvironment，兼容旧Python路径/Ark选择，不擅改已有会话 | 同项目显示默认A，Notebook覆盖B、ConsoleC、脚本run配置D；每个实际`sys.executable`或`R.home()`匹配其UI；改默认不影响正在跑的B/C                                                 |
| **DS-01E1：Python venv闭环**  | 复用ide-sdk创建/发现/包后端；环境picker、新建入口、缺ipykernel/debugpy修复与诊断；按选定解释器启动                                                                      | 两个venv指向同一base仍分别列出；创建→选择→Notebook/Console/脚本debug各运行；A中安装测试包，B不能导入；含空格路径/关闭重开/环境被删均有明确结果                                |
| **DS-01E2：R版本与项目包库**  | Ark/R环境owner负责R二进制→RHOME/版本发现、手选路径、项目根/库路径启动描述；UI统一展示R与Ark版本和有效库                                                                 | 至少两套R安装若环境可得则分别选测，否则明确多版本未验；两个项目包库隔离，`.libPaths()`、`R.home()`、`getwd()`与UI一致；不把改变包库冒充切R版本                                |
| **DS-01E3：R renv激活闭环**   | 与E2同owner接续，读取renv.lock/activate.R/.Rprofile状态；可信项目显式选择renv模式，启动后验证实际库；非renv项目保留正常Ark                                              | 两个renv项目各自安装不同版本样本包；从子目录打开notebook也激活正确项目；R Console、Notebook、同kernel调试共享所选库；重启后保留，另一项目不被改变；缺renv/不兼容R给可操作失败 |
| **DS-01E4：环境一致性回归**   | E0合同冻结后测试/UI owner独立；与DS-04A共用真实debug样本，避免另造解释器解析器                                                                                          | 脚本run/debug/test、Notebook、Console、LSP分别记录解析来源与有效路径；期望一致时一致，显式覆盖时准确展示差异；中断/重启/并行两个环境无串用                                    |

建议先做 E0 + E1 与 E2 的只读发现并行；E2→E3涉及同kernel启动路径，应由单一owner串行，与DS-04B broker明确排期。环境UI可独立做模型/组件，但不得在合同未定前重复改Notebook session与bindings。root统一生成bindings、集成计划和提交。

### 最小共享合同建议

- `EnvironmentDescriptor`：稳定ID、language、manager、displayName、interpreter路径/版本、可用性与诊断。Python再含prefix/basePrefix；R再含R_HOME、Ark路径/版本、projectRoot、renv状态与library paths。
- `EnvironmentSelection`：`project-default` 或显式ID；作用域为项目/run配置/Notebook/Console，记录选择来源。实际启动生成`ResolvedEnvironment`快照，UI显示它而不是可变默认值。
- R renv状态区分 `not-present / detected-inactive / active / lock-mismatch / unavailable`；发现renv.lock不等于active，必须真实查询会话。
- 环境ID与kernel generation分开；环境切换创建新generation，旧debug/变量/表格句柄失效。相同解释器但不同projectRoot/renv库不应复用同一个R进程。
- 包操作显式绑定目标EnvironmentDescriptor/项目；目标正被运行会话使用时记录状态刷新需求，不伪称已加载模块随磁盘版本自动变化。

## P1：完整管理器与可复现操作

| 子项                                      | 开发目标                                                                                                                              | 验收                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DS-08E1：Conda/Mamba**                  | 使用可用管理器的机器可读环境清单补全发现；识别自定义prefix与配置目录；处理激活对动态库/环境变量的要求；创建/import/update作为显式动作 | 非默认目录conda环境可选；真实含native依赖包运行/调试可用；环境清单查询超时可取消；导入失败保留日志，不删除用户既有环境。各CLI具体版本固定后验命令 |
| **DS-08E2：uv项目环境**                   | 识别pyproject.toml/uv.lock和有效项目环境，复用uv CLI；明确lock/sync/run的副作用与模式                                                 | 选择已存在环境不会隐式sync改包；用户触发sync才更新；lock不一致有明确结果；运行遵循项目选择，不能用一次uv扫描悄悄下载Python                        |
| **DS-08E3：Poetry环境**                   | 用项目cwd中的`poetry env info --executable`/`--path`查询，不仅枚举固定缓存目录；支持in-project及外部自定义位置                        | 两项目返回各自环境，空格路径/缺环境可处理；查询不创建或安装；选择后脚本/Notebook使用相同解释器；创建/install/sync独立显式操作                     |
| **DS-08E4：R renv状态与snapshot/restore** | 先只读status/lock差异，随后显式init/snapshot/restore；库路径、包源、R版本差异与日志可见，操作可取消                                   | snapshot前后lock差异可核；restore到干净项目后样本包版本吻合；离线/编译失败准确报告；不自动覆盖用户.Rprofile或执行restore，也不宣称重现系统依赖    |
| **DS-07E：包界面接环境**                  | 包列表/安装/更新/删除与E0目标关联；Python复用pip/uv，R按实际项目library/renv处理                                                      | 只改变目标环境；两项目交叉查询验证无污染；列表展示包安装库与版本，缺权限/源错误有具体日志                                                         |

远端/容器环境ID与本地路径分属不同执行位置，后续扩展时必须包含执行目标。此批P0先保证本地闭环，不用本地绝对路径假装已覆盖远端；R与Python的环境共享UI不意味着其安装/启动命令可互换。

## 建议追加到 FEATURE-BACKLOG 的简短条目

> **环境支持优先提升（2026-11-06，用户明确要求）**：DS-01E0–E4列P0，与DS-04调试并行。Python优先现有venv创建/发现/选择/依赖修复闭环；R优先多R版本选择、实际library paths和renv项目激活，修复当前Ark `--vanilla` 与项目.Rprofile激活之间的缺口。项目默认、运行配置覆盖和Notebook/Console会话覆盖必须明确，切默认不影响已有会话。Conda/Mamba、uv、Poetry完整管理器接入及renv snapshot/restore列DS-08E1–E4/P1，包管理接DS-07E。详细边界/验收见 [环境研究](research/2026-11-06-environments.md)。这些是计划，不能标作已支持。

## 官方资料核验

2026-11-06访问以下文档站点受当前网络策略403限制，因此改读相同项目的官方GitHub文档源码；未把失败抓取声称为已打开网页。R手册使用R源码只读镜像，明确其为镜像而非R官方仓库。

- [P1 Python venv官方文档源码](https://github.com/python/cpython/blob/main/Doc/library/venv.rst)：独立site-packages、sys.prefix/base_prefix、无需activate即可直接调用解释器；环境一般不可移植，应重建。
- [P2 uv environments](https://github.com/astral-sh/uv/blob/main/docs/pip/environments.md)、[项目layout](https://github.com/astral-sh/uv/blob/main/docs/concepts/projects/layout.md)、[项目sync](https://github.com/astral-sh/uv/blob/main/docs/concepts/projects/sync.md)：环境发现、项目.venv、锁定/同步语义；最初尝试`concepts/projects/environments.md`不存在，未引用该路径。
- [P3 Poetry managing environments](https://github.com/python-poetry/poetry/blob/main/docs/managing-environments.md)：`env info --executable`/`--path`与in-project选项。
- [P4 Conda managing environments](https://github.com/conda/conda/blob/main/docs/source/user-guide/tasks/manage-environments.rst)：命名/prefix环境、清单、激活与原生库环境要求。CLI实现须核实际安装版本，不能只依赖main文档命令。
- [R1 renv introduction官方源码](https://github.com/rstudio/renv/blob/main/vignettes/renv.Rmd)：项目library、.Rprofile、renv.lock、init/snapshot/restore和隔离语义。
- [R2 renv activate官方实现/文档](https://github.com/rstudio/renv/blob/main/R/activate.R)：激活配置与项目启动接缝。
- [R3 R libPaths手册源码镜像](https://github.com/wch/r-source/blob/trunk/src/library/base/man/libPaths.Rd)：`.libPaths()`、R_LIBS/R_LIBS_USER/R_LIBS_SITE。
- [R4 R Startup手册源码镜像](https://github.com/wch/r-source/blob/trunk/src/library/base/man/Startup.Rd)：.Rprofile、R_PROFILE_USER和`--vanilla`抑制启动文件的语义。

本文件未增加第三方依赖或复制其实现；引用文档只为定义行为与验收。多R版本、conda、renv等真实测试环境尚需按任务准备，未执行部分保持未验状态。
