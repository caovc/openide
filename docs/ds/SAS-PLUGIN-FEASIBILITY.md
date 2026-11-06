# U10 可行性：OpenIDE 插件 vs Windows SAS IDE

> 调研日期：2026-11-06（Asia/Shanghai）。只读结论；未改产品代码。  
> 对照代码：本仓 `wit/` / `plugins/README.md` / `crates/ide-plugin` / `crates/ide-extension`；SasDesktop v2 `/workspace/sas-desktop-v2`；既有调研 `/workspace/sas-eg-java/Windows本机直连SAS_客户端调研.md`。  
> API 版本：`openidea:plugin@1.2.0`（`wit/plugin.wit`）；插件系统文档自称 **Preview**，官方插件 `0.x`。上游发布节奏可能继续加 import，但 **不能** 假定即将开放原生 DLL / .NET / COM 宿主。

## 结论（先行）

**判定：有条件可以；不适合「纯 OpenIDEA WASM 插件」单独交付完整 SAS IDE。**

推荐一句话架构：

> **Windows-only：OpenIDE 一等公民 DS 功能（Tauri/React）+ 托管 .NET COM 侧车（复用 SasDesktop.Core / `ComSasSession`）经 stdio/命名管道 JSON-RPC；WASM 插件仅可选地承担语法/主题等声明式贡献，不承载 SAS 会话。**

与既定记忆一致：`COM → .NET 后端 → 接入现有 Tauri`；相对 Ark/R/Python 主线后置（U10）。

---

## A. OpenIDE / openidea 当前插件模型

### 运行时

| 项        | 事实                                                                                     | 出处                                                                      |
| --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 形态      | **WebAssembly Component**（component model + WASI preview 2）                            | `wit/plugin.wit`、`plugins/README.md`、`crates/ide-plugin`（wasmtime 49） |
| 包格式    | 目录 + `plugin.toml`，可选 `wasm`；可打 `.oiplugin`                                      | `plugins/README.md` §2 / §8                                               |
| 沙箱      | 无预开目录、无环境变量、无任意网络/进程；仅 clocks/random + 宿主 import                  | `wit/plugin.wit` 头部注释；`plugins/README.md` §3 Sandbox                 |
| 限额      | 调用约 5e9 wasm 指令；命令/激活 5s；编辑器 provider 50ms（500ms 打断）；线性内存 256 MiB | 同上                                                                      |
| 平台条件  | 能力模型无 `os:windows` 之类；`process:<program>` 可钉死绝对路径（含 Windows 路径）      | `crates/ide-extension/src/capability.rs`                                  |
| 原生/.NET | **无** 加载 DLL、COM、CLR、JNI 的扩展点                                                  | 全仓 WIT / README；`ide-plugin` 仅 wasmtime                               |

### 宿主能力（插件可调用）

声明式贡献（无需 wasm）：themes、iconThemes、languages、menus、keymaps、statusBar、settings、fileIcons、fileTemplates、runDetectors、部分 views/customEditors（`web=`）。

代码能力（需能力批准）：

- `project.read` / `editor.read|write` / `vcs.*` / `storage` / `events` / `diagnostics`
- `net:<host>`（HTTPS；**明文 HTTP 仅 localhost**）
- `process:<program>` → **`process.run`：启动、等待结束、回收 stdout/stderr（各 ≤4 MiB）**（`wit/io.wit`）
- `views`：声明式 Tree/List/Form/Table/Message/**Html**；Html/WebView **沙箱 iframe**：无外网、无 IDE API，仅 `openidea.postMessage` / `document.*`（`wit/views.wit`、`plugins/README.md` Web views）
- `views.open-terminal`：在终端标签跑已批准程序（交互终端，不是结构化 RPC 会话）
- language-servers / debugger：由 **宿主** 按语言贡献拉长生命周期进程（不是插件自己 `process.run` 常驻）

### 能力边界（对 SAS 的含义）

1. **不能**在插件内直接 COM / .NET / STA 线程驱动 `sas.exe`。
2. **`process.run` 是一次性同步跑完**，不适合托管「长会话 + 流式日志 + Cancel」的 COM Workspace；也没有官方「托管后台侧车 + 双向事件」API。
3. 插件 Html/Web 视图 **不能**自己连本机 HTTP 侧车（CSP/无网络）；即便用 `net:localhost`，也只能从 **wasm 宿主线程** `fetch`，且仍缺「宿主代管长进程生命周期」的一等能力。
4. 把整个 SAS 后端伪装成 language-server 理论上可偷到长进程，但 LSP 语义盖不住 ODS/库表/预览/取消/编码切换；会扭曲平台并与 DS Console/Session 模型打架。
5. **可以**做的：SAS 语言 TOML、syntax-provider、格式化外置工具、声明式库树壳、对接已由 **宿主** 提供的会话 API（若做成一等功能）。

**不确定性**：Preview API 会加 import；若未来官方增加 `sidecar` / 长生命周期 process 订阅，纯插件路径可再评估。以 2026-11-06 代码为准，**当前不能赌**。

---

## B. SasDesktop 功能清单与可插件化分级

对照 **SasDesktop 2.3.x**（`/workspace/sas-desktop-v2`）：WPF + WebView2 宿主，UI 为 Vue3，业务在 C#（`SasDesktop.Backend` / `Core` / `Com/`）。协议见 `docs/BRIDGE.md`。

### 分级

| 级                               | 含义                                         |
| -------------------------------- | -------------------------------------------- |
| **F** 纯前端/声明式              | 可迁 React/Monaco/OpenIDE tokens；不依赖 COM |
| **H** 需宿主一等 API             | 要 Tauri/`ide-host` 管进程、事件、权限、打包 |
| **W** 必须 Windows 原生 COM/.NET | IOM COM、STA、注册表、凭据管理器、提权注册   |

### 功能表（摘要）

| 能力                                | 级                              | SasDesktop 锚点                                            | 说明                                                           |
| ----------------------------------- | ------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `.sas` 编辑、主题、命令面板、文件树 | F                               | `web/src/components/*`、Monaco                             | OpenIDE 已有编辑器/工程树；可加 `languages/sas.toml`           |
| SAS 语法高亮 / 大纲                 | F（或 wasm syntax）             | Monaco 分词；另有 `SasDesktop.Formatter` + tree-sitter-sas | 可官方语言包或 syntax-provider；格式化可 `process:` 外置       |
| 连接本机 SAS（Local COM）           | **W+H**                         | `Com/ComSasSession.cs`、`ComRuntime`、`StaWorker`          | `ObjectFactoryMulti2` + ProtocolCom；专用 STA                  |
| IOM Bridge / 元数据选服务器         | **W+H**                         | `ComMetadataConnector`、`meta.*`                           | Bridge Protocol=2；密码内存/凭据库                             |
| 提交 / 异步日志 / Cancel            | **W+H**                         | `sas.run`、`FlushLogLines` 轮询、`LanguageService.Cancel`  | 长会话 + 事件流                                                |
| ODS HTML5 结果                      | H（文件）+W（生成）             | `results` 事件、虚拟主机 `results.sasdesktop`              | 结果文件本地读；UI 可用沙箱 WebView                            |
| 逻辑库 / 成员 / 宏 / fileref        | **W+H**                         | `sas.refreshLibraries`、`members`、`macros`、`filerefs`    | DataService / dictionary\*                                     |
| 数据集预览（分页 WHERE/ORDER）      | **W+H** → 接 U9 `TableProvider` | `sas.preview`、`tableInfo`、`distinct`                     | 契约已预留 SAS missing codes（`ds-data-explorer/contract.ts`） |
| 编码/nls 切换、HKCU LocalServer32   | **W**                           | `ComLaunchOverride`、`sas.registerElevated`                | 管理员回退                                                     |
| 危险代码确认（Agent 路径）          | F+H                             | `DangerDetector`、`confirm.*`                              | 逻辑可移植；弹窗走宿主                                         |
| ACP Agent + SAS MCP                 | H（可后置）                     | `Acp/*`、`Mcp/*`                                           | 与 OpenIDE agent 栈需产品取舍，勿首期强绑                      |
| Git / 多窗口 / 安装包               | H / 产品                        | Backend Git、Inno                                          | OpenIDE 已有 VCS；安装走 Tauri + 侧车附带                      |

v1 Blazor 版（`/workspace/sas-desktop`）已证明 COM 路径；**复用应以 v2 Core + Com 为准**（协议与测试更完整）。

---

## C. 三条路径对比

| 路径                                                       | 做法                                                                                          | 优点                                                                      | 缺点                                                                | 结论                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| **1) 纯 openidea 插件**                                    | 仅 WASM + 声明式 + `process.run`/`net:localhost` 凑合                                         | 不改宿主；可上架 marketplace                                              | 无合法长会话托管；COM 不可达；Html 无网；与 Console/Session/U9 脱节 | **否决作主路径**         |
| **2) Tauri 主程序 + Windows .NET 侧车**（插件只做壳/可选） | 宿主 spawn 侧车；JSON-RPC；UI 用 `src/features/ds-sas/**` 等一等功能；可选 WASM 只做语言/主题 | 对齐记忆与 SasDesktop 资产；接 U6/U7/U8/U9 适配器；生命周期/取消/打包可控 | 要改 `ide-host`/`src-tauri`（`cfg(windows)`）；双运行时打包         | **推荐**                 |
| **3) 独立 SasDesktop + OpenIDE 深链/嵌入**                 | 两产品并行；协议/URL/互开文件                                                                 | 零风险碰 DS 主线；SAS 功能已完整                                          | 双 IDE 体验分裂；变量/数据探索难共用；长期维护两套 UI               | **过渡可接受，不作终局** |

---

## D. 推荐、MVP、风险

### 推荐

走 **路径 2**。把 U10 写成：**host-managed SAS runtime**，不是 marketplace 插件故事。  
详细里程碑与目录见 [SAS-PLUGIN-PLAN.md](./SAS-PLUGIN-PLAN.md)。

### MVP（最小真实验证切片）

Windows + 已注册 64 位 SAS 上：

1. 宿主启动/退出侧车，无僵尸 `sas.exe`。
2. Local COM 连接 + 提交 `data _null_; put "openide_sas_ok"; run;` + 彩色/行类型日志事件。
3. Cancel 可打断长步骤（或超时强杀会话并提示重连）。
4. OpenIDE 编辑器 Run / Console 之一能把代码打到该会话（接 U7/U8 契约，语言=`sas`）。

不做首期：元数据服务器、ACP/MCP、完整 Git 宿主、Vue UI 迁移、非 Windows 假连接冒充真 SAS。

### 主要风险

| 风险                                        | 缓解                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| COM STA 线程模型 / 释放 / 僵尸进程          | 原样复用 `StaWorker` + `ComRuntime`；侧车单一 COM 线程；宿主 kill 树       |
| SAS 第三方客户端许可【未验证】              | 上线前书面确认（既有调研已标出）                                           |
| 打包：.NET 侧车 + WebView2/Tauri + SAS 依赖 | 侧车框架依赖或自包含；SAS 不捆绑，自检 COM                                 |
| 与 DS 主线抢路径                            | U10 认领独立目录；不改 notebook Ark 主路径；`SessionAdapter::sas` 显式实现 |
| 插件用户预期                                | 文档写明：SAS 是 Windows 运行时功能，不是 `.oiplugin` 一键安装 COM         |

### 与 DS 主线关系

- U6 已留 `SessionAdapter::sas()` → `unavailable`（`crates/ide-notebook/src/session_adapter.rs`）。
- U9 `TableProvider` / SAS missing codes 已在契约层预留。
- U10 排在 U1–U9 核心之后（BOARD/ROADMAP Later）；实现期并行只允许路径无交叠的文档/侧车仓。

---

## E. 参考路径速查

| 主题          | 路径                                                                |
| ------------- | ------------------------------------------------------------------- |
| 插件 WIT      | `/workspace/openide/wit/*.wit`（包版本 1.2.0）                      |
| 插件文档      | `/workspace/openide/plugins/README.md`                              |
| 运行时        | `/workspace/openide/crates/ide-plugin`、`ide-host`、`ide-extension` |
| SAS 会话桩    | `crates/ide-notebook/src/session_adapter.rs`                        |
| 数据契约      | `src/features/ds-data-explorer/contract.ts`、`ADAPTER.md`           |
| SasDesktop 桥 | `/workspace/sas-desktop-v2/docs/BRIDGE.md`                          |
| COM 会话      | `/workspace/sas-desktop-v2/src/SasDesktop/Com/ComSasSession.cs`     |
| 本机 COM 调研 | `/workspace/sas-eg-java/Windows本机直连SAS_客户端调研.md`           |
