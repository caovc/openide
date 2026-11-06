# OpenIDE DS 产品范围

## 目标用户与对标

面向需要在同一桌面 IDE 中探索数据、写脚本与 notebook、运行及调试 Python / R 的数据科学工作者、分析师与研究人员。

保留 OpenIDEA 核心编辑、项目、终端、语言服务和界面。DataSpell 对标 notebook / 数据探索体验；RStudio 对标 R 会话、变量、图表与 HTML widgets；Positron 对标多语言会话与运行时协议。对标是工作流目标，不是复制其实现或视觉源码的授权。

## In scope

- Python / R / Jupyter 的执行、调试与会话生命周期；Python notebook 现有 ipykernel 行为不回退。
- Python / R Console 交互会话（不依赖 notebook），规划 U7。
- 编辑器直接运行 Python / R 的选中代码或当前文件，规划 U8；接入明确的交互会话。
- R 使用 `posit-dev/ark` 的 Jupyter kernel、LSP 和 DAP，不以 languageserver + IRkernel 作为目标架构。
- R 环境发现、kernel 选择、会话关联编辑器语言服务。
- R / Python 共用 Session 变量查看器、DataFrame 探索、图表历史与查看、HTML widgets 展示，复用既有 tool window 贡献点；会话与语言适配器分离。
- Python / R 包可视化管理（能力差异分别支持）；R 另含包文档浏览（规划 U12）。
- 数据查看 / 探索能力对标 JetBrains DataSpell / IDEA：同时支持 R 与 Python，架构预留后续 SAS 适配。可评估 dbx 高性能组件，但先确认具体组件、来源、许可证及集成边界；UI 向 JetBrains IDE 工作流与风格靠拢，沿用本仓 tokens，不复制其源码。

## Out of scope（当前阶段）

- 重写核心 IDE 壳、另建 UI 设计体系、无差别删除无关上游功能。
- JVM / Java / Kotlin / Scala / Groovy / Clojure / JSP IDE 功能：用户已要求 U11 硬移除，当前批次删除内置语言/安装/构建/运行/调试/UI链。旧配置仅保留数据，不再执行；不删除用户项目源文件或外部 JDK。
- 复制 Positron（Elastic-2.0）UI 源码或未经许可证审核引入数据查看组件。
- 第一单位同时做 UI、完整 R 环境管理、所有调试功能或 HTML widgets。
- 要求用户先运行 Positron 才能使用 R；假定 Ark 协议与版本永远兼容。

## 第一阶段完成谓词：Ark 无 UI 冒烟

以下必须是实测证据，不能以 mock 或“启动成功”替代：

1. 固定并记录 Ark 版本/commit、来源、R 版本及环境；**无 Positron 进程**，由本仓启动 Ark 并完成 Jupyter 会话连接。
2. 经真实 ZMQ 执行 `x <- 41; x + 1`，获得值 `42`，记录请求/响应关联与完成状态。
3. 经该会话的 comm 启动/发现 Ark LSP，完成 LSP 初始化及至少一次真实 hover 或 completion，得到有内容、与测试文档相符的结果。
4. 正常关闭和失败/超时清理后，本探针启动的 Ark、R、LSP 子进程均无残留；不影响其他会话进程。
5. 保存可复跑命令、版本、退出码、响应摘要与进程清理证据；缺依赖须标为 blocked，不算通过。

以上仅验收 U1，不宣称 UI 或完整产品已完成。后续单位各自验证，见 [ROADMAP.md](ROADMAP.md)；环境限制见 [ENV.md](../../ENV.md)。

## Python / R 调试验收

调试是核心能力，不仅是后端协议存在。Python脚本使用debugpy；Python Notebook使用Jupyter Debug Protocol；R脚本/Console与Notebook使用固定版本Ark公开DAP接口。每条路径分别验收断点命中、继续/暂停/步进、调用栈/局部变量/表达式、错误定位、重启清理与多会话隔离。Notebook还需kernel能力协商与cell源映射。具体任务DS-04A..D及官方来源见[功能队列](FEATURE-BACKLOG.md)。
