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
- JVM / Java / Kotlin / Scala / Groovy IDE 功能：阶段 A 已默认软隐藏（语言包、运行/调试选择器、Java / Maven / Gradle 设置）；保留实现和配置供诊断，不承诺支持。阶段 B 硬移除列为后续 U11，不在本次实施。
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
