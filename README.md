# OpenIDE

面向数据科学的桌面 IDE（版本 **0.1.0**）。在 OpenIDEA（Tauri 2 + Rust + React）核心之上，聚焦 **Python / R / Jupyter** 工作流，对标 DataSpell、RStudio、Positron 的使用方式（工作流目标，不复制其源码）。

仓库：https://github.com/caovc/openide

## 当前能力（已验证切片）

| 能力 | 状态 |
| --- | --- |
| R（Posit [Ark](https://github.com/posit-dev/ark)）无 UI ZMQ 执行 / LSP / DAP / stdin | 已通过集成冒烟 |
| Python notebook（ipykernel）不回退 | 已回归 |
| 共用 Session 变量与图表（R + Python） | runtime 已验；GUI 待验 |
| Console（notebook 外交互） | host 已验；GUI 待验 |
| 编辑器 Run（选区 / 当前文件 → Console） | unit/DOM 已验；原生 GUI 待验 |
| 数据探索 `TableProvider` + Ark DataExplorer 薄切片 | U9.1 + U9.2a smoke PASS |
| JVM / Java 相关 IDE 能力 | 默认软隐藏（诊断可开） |

详细范围与验收谓词见 [`docs/ds/PRODUCT.md`](docs/ds/PRODUCT.md)、路线图 [`docs/ds/ROADMAP.md`](docs/ds/ROADMAP.md)、状态板 [`.agents/BOARD.md`](.agents/BOARD.md)。云端继续开发请读 [`docs/ds/HANDOFF-CLOUD-CODEX.md`](docs/ds/HANDOFF-CLOUD-CODEX.md)。

## 技术栈

- 桌面壳：Tauri 2（Rust）
- 前端：React + TypeScript + Vite + pnpm
- R 运行时：Ark Jupyter kernel + 会话 LSP/DAP
- 本地环境说明：[`ENV.md`](ENV.md)

## 开发

```bash
pnpm install
# 系统依赖与 Rust 版本见 ENV.md
pnpm tauri dev
```

有意义的 Rust / 前端测试按单位报告执行；Ark 真实冒烟需要本机 Ark 二进制与 R，例如：

```bash
PATH=$HOME/.cargo/bin:/path/to/r/bin:$PATH \
OPENIDE_ARK=/path/to/ark \
R_HOME=/path/to/R \
cargo test -p ide-notebook --test ark_explorer -- --ignored --nocapture --test-threads=1
```

## 后续规划（摘要）

- U9：数据探索 UI（参考 [t8y2/dbx](https://github.com/t8y2/dbx) canvas，Apache-2.0）与 Python 适配、HTML widgets
- U10：Windows SAS（COM → .NET → Tauri，后置）
- U11：JVM 相关能力硬删除
- U12：Python / R 包可视化管理；R 含包文档浏览

## 许可与归属

[Apache 2.0](LICENSE)。本仓库自有提交历史从 OpenIDE DS 快照起算；实现派生自 [OpenIDEA](https://github.com/l0ng-ai/openidea) 的 Apache-2.0 代码，第三方资产见 [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) 与 [`NOTICE`](NOTICE)。

与 JetBrains / Posit / Databricks 无附属关系。IntelliJ、DataSpell 等为对应权利人商标。
