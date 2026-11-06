# U10 方案与开发计划：Windows SAS 运行时接入 OpenIDE

> 配套可行性结论：[SAS-PLUGIN-FEASIBILITY.md](./SAS-PLUGIN-FEASIBILITY.md)  
> 状态：设计文档（2026-11-06）。**未认领、未开工实现。** 认领前按 [COLLAB.md](./COLLAB.md) 登记路径。  
> 目标远程：`caovc/openide`；SasDesktop 资产在 `caovc/SasDesktop` / 本地 `/workspace/sas-desktop-v2`。

## 0. 一句话架构

**OpenIDE（Tauri + Rust `ide-host` + React）在 Windows 上托管 `openide-sas-sidecar`（.NET，复用 SasDesktop COM/Core），经 JSON-RPC（stdio 或命名管道）驱动本机/Bridge SAS；UI 走 DS 一等功能，不走纯 WASM 插件承载会话。**

```
┌──────────── OpenIDE (全平台 UI；SAS 入口仅 Windows 显示) ────────────┐
│  React: ds-sas / Console / Editor Run / Data Explorer / Results     │
│  Tauri commands + events                                            │
│  ide-host: sas_runtime (cfg(windows)) — spawn/supervise sidecar     │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ JSON-RPC (req/res/evt) ≈ SasDesktop BRIDGE 子集
┌───────────────────────────▼─────────────────────────────────────────┐
│  openide-sas-sidecar.exe  (.NET, win-x64)                           │
│  复用: SasDesktop.Core (Sas/*, Rpc, Util) + Com/* (STA, ComSasSession)│
│  不复用: WPF 壳、Vue web/、WebView2 策略（UI 已在 OpenIDE）            │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ COM IOM
                      sas.exe Workspace
```

非 Windows：不启动侧车；设置页说明「SAS 需 Windows + 本机 SAS」；`SessionAdapter::sas` 保持 `unavailable`。

---

## 1. 为何不是「纯插件」

见可行性文档 §A/§C。摘要：`openidea:plugin@1.2.0` 为沙箱 WASM；`process.run` 一次性等待；无 COM/.NET；Html 视图无网络。SAS 长会话必须 **宿主代管进程**。

可选后续：`plugins/official` 或社区包装 **仅** `languages/sas` + 主题/图标 +（若有）syntax wasm；**禁止**在插件里承诺「安装即连接 SAS」。

---

## 2. 与 SasDesktop 的复用边界

| 复用（建议 submodule / 稀疏拷贝 / 内部 NuGet）                                                                   | 不复用 / 重写                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `SasDesktop.Core`：`Sas/*`、`DangerDetector`、`SasLog`、`SasCodeBuilder`、`SasInstall`、`Metadata/*`、`Rpc` 信封 | `src/SasDesktop` WPF、`MainWindow`、WebView2、`web/` Vue                |
| `Com/*`：`ComSasSession`、`StaWorker`、`ComRuntime`、`ComLaunchOverride`、`ComMetadataConnector`                 | 整窗多窗口管理、VS Code 仿壳、Inno 独立品牌安装（可另议共享侧车安装器） |
| 协议思想：`docs/BRIDGE.md` 的 req/res/evt；方法子集见下                                                          | 前端 `protocol.ts` 原样（改为 OpenIDE TS + specta/Rust 类型）           |
| `SasDesktop.Formatter` / tree-sitter-sas（可选 U10.4）                                                           | ACP/MCP 首期（与 OpenIDE agent 合并需单独产品决策）                     |
| 单测：`FakeSasSession`、Metadata fake                                                                            | 依赖 WebView 的 UI 测                                                   |

**许可与仓库**：SasDesktop 与 OpenIDE 均为用户自有仓时，推荐 **侧车独立小仓或 `native/sas-sidecar/`** 引用 Core 项目，避免把 WPF 工程拖进 OpenIDE CI（Linux CI 只编协议假会话）。

---

## 3. 建议目录与 crate（认领时锁定）

```
/workspace/openide/
  docs/ds/SAS-PLUGIN-*.md          # 本文档（已有）
  languages/sas.toml               # U10.2+ 语言探测（可先无 LS）
  crates/ide-sas/                  # 新：协议类型、侧车客户端、假会话（unix 可测）
  crates/ide-host/src/ops/sas.rs   # 新：cfg(windows) spawn + 事件泵；其它 OS stub
  src-tauri/src/commands/sas.rs    # 新：IPC 命令（生成 bindings）
  src/features/ds-sas/             # 新：连接 UI、日志/结果面板壳、状态 store
  native/sas-sidecar/              # 新：.NET 工程（或 git submodule → 抽出的侧车仓）
```

**刻意不碰（并行安全）**：`crates/ide-notebook/src/ark*.rs`、U9 dbx 移植中的 canvas 文件、Java 硬删路径。仅允许改 `session_adapter.rs` 的 SAS 分支与显式注册点（认领时写明）。

前端接缝（只读现有契约，实现时认领）：

- Console / Editor Run：`src/features/ds-console/**`、`ds-editor-run/**`（扩语言 `sas`）
- Session / Explorer：`ds-session/**`、`ds-data-explorer/**`（`TableProvider` 适配器）

---

## 4. 侧车协议（MVP 子集）

对齐 SasDesktop 信封（camelCase JSON）：

- `req` / `res` / `evt`；错误码同 BRIDGE。
- MVP 方法：`app.hello`（版本/能力协商）、`sas.connect`、`sas.disconnect`、`sas.run`、`sas.cancel`、`sas.getLog`、`sas.refreshLibraries`、`sas.members`、`sas.preview`（可第二刀）。
- MVP 事件：`state`、`log`（含 `runId`/`seq`）、`run.started`、`run.finished`。
- 非 MVP：`meta.*`、`agent.*`、`git.*`、`fs.*`（文件用 OpenIDE VFS）、`win.*`。

侧车启动：`openide-sas-sidecar --stdio`（或 `--pipe <name>`）。宿主负责 stdin/stdout 帧（长度前缀或 NDJSON，实现时二选一写进 `ide-sas` 并单测）。

---

## 5. 分阶段里程碑（可派给其他 agent）

### U10.0 文档与契约冻结（本阶段交付）

- [x] 可行性 + 本计划
- [ ] BOARD/ROADMAP U10 指向本文
- **验收**：两份 md 合入；编号语义仍为 Windows SAS，不插入新 U 号挤占 U11/U12。

### U10.1 侧车骨架 + 假会话（Linux CI 可测）

- 抽出/新建 `openide-sas-sidecar`：无 WPF；`FakeSasSession` 实现 connect/run/log。
- `crates/ide-sas` 客户端 + 协议单测。
- **验收**：`cargo test -p ide-sas`；`dotnet test` 侧车核心；无真实 SAS。

### U10.2 Windows COM 真连接（用户机 / Windows runner）

- 链入 `ComSasSession`；自检 COM 注册；连接进度。
- 宿主 `cfg(windows)` 启动侧车、崩溃重启策略、退出杀进程树。
- **验收**：真机 Local COM；提交 put 语句见日志；断开无残留 sas.exe（证据脚本进 `.audit/u10-*`）。

### U10.3 接入 Console + Editor Run

- 实现 `SessionAdapter` SAS 路径或并行 `SasSessionManager`（若 notebook KernelRuntime 模型不适配 COM，允许 **独立会话管理器**，但变量/面板仍走同一 UI 契约）。
- `ds-editor-run` / `ds-console` 识别 `.sas`。
- **验收**：编辑器选区/文件 → 会话；busy/cancel；与 Python/R 会话不串（无 SAS 时不影响既有测）。

### U10.4 库表 + TableProvider + ODS 结果

- `sas.refreshLibraries` / `preview` → U9 `TableProvider`。
- 结果 HTML 面板（沙箱 WebView 或 tool window）。
- **验收**：打开 `SASHELP.CLASS` 类表分页；一次 ODS HTML 可显示；取消与刷新不花屏。

### U10.5 打包与产品化（后置）

- Tauri Windows 包附带侧车；设置页；编码/nls 切换；许可文案。
- Bridge/元数据、Formatter、Agent/MCP 按需单独立项。
- **验收**：干净 Win11 + SAS 9.4 安装说明可跑通 MVP；无 SAS 时降级提示清晰。

---

## 6. 派工切片（给其他 agent 的任务卡）

| ID              | 依赖    | 建议路径所有权                                 | 产出                        |
| --------------- | ------- | ---------------------------------------------- | --------------------------- |
| T1 协议 crate   | U10.0   | `crates/ide-sas/**`                            | 类型、编解码、mock 循环     |
| T2 侧车 Fake    | T1      | `native/sas-sidecar/**`（或外仓）              | stdio 服务器 + FakeSas      |
| T3 COM 接入     | T2      | 仅 `Com/` + Core 引用                          | 真连接证据                  |
| T4 host spawn   | T1      | `ide-host/src/ops/sas.rs`、`src-tauri/**`      | Windows spawn；其它 OS stub |
| T5 UI 连接/日志 | T4      | `src/features/ds-sas/**`                       | 连接条 + 日志 view          |
| T6 Console/Run  | T4–T5   | `ds-console`、`ds-editor-run`、session_adapter | 端到端 Run                  |
| T7 Explorer     | T3+U9.1 | `ds-data-explorer` 新 `sas.ts`                 | TableProvider               |
| T8 打包         | T3+T5   | `src-tauri`、packaging 文档                    | 附带侧车                    |

并行规则：T1∥T2 文档期后可开；T5 不改 notebook；T6 与 U9 canvas **禁止**同文件；T3 需 Windows。

---

## 7. Windows-only 约束清单

- 侧车与 COM 代码：`net*-windows` / `cfg(windows)`。
- Linux/macOS CI：只测协议 + Fake；COM 测标记 `#[ignore]` 或独立 job。
- UI：命令与设置用 feature flag / `OPENIDE_SAS=1` 或运行时 `cfg` 探测侧车存在。
- 远程开发：侧车必须跑在 **有 SAS 的 Windows 机器**（远程窗的 server 侧）；首期可不支持 remote SAS。

---

## 8. 与 DS 主线并行注意

1. **后置**：不阻塞 U9 收尾、U12 设计；U10 认领前保持 `pending`。
2. **接口单向依赖**：SAS 适配器实现 U6/U9 已公布契约；不得为 SAS 改恶化 Python/R 语义。
3. **进程隔离**：SAS 失败不得拖垮 `KernelManager`；侧车崩只标 SAS faulted。
4. **产品叙事**：OpenIDE = DS IDE（Python/R 优先）；SAS = Windows 附加运行时，不是插件市场卖点。
5. **历史仓**：SasDesktop 继续可独立发版（路径 3）直到 U10.5；避免两边同时大改 Core 而不切分支。

---

## 9. 风险登记（实现期必看）

- COM STA + 异步 Submit + Cancel 竞态 → 复用 v2 轮询设计，勿改回连接点事件除非有证据。
- 许可【未验证】→ 发布前确认。
- 64/32 位 → 固定 win-x64 侧车与 64 位 SAS。
- 僵尸 sas.exe → 宿主 drop 时 `Workspace.Close` + 进程树杀；审计脚本。
- 把 Vue 整包塞进 OpenIDE → **禁止**；只迁交互合同与必要样式 tokens。

---

## 10. 成功标准（U10 整包）

在目标 Windows + SAS 9.4 上，用户无需打开独立 SasDesktop，即可在 OpenIDE 中：连接本机 SAS、运行 `.sas`、看日志与结果、浏览库表预览；Python/R 回归仍绿；非 Windows 构建不被 SAS 代码破坏。
