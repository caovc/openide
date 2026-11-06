# renv 启动合同：B0 后的结构化环境身份

日期：2026-11-06；基线：`2edb535`。状态：设计交付，**未实现**。生产 transport 当前归 B1 调试 broker 所有；以下工作待 B1 合并后串行实施。

前置证据见 [renv 实际激活探针](2026-11-06-renv-activation.md)：R 4.5.0 / Ark 0.1.252 / renv 1.2.3 两个同时存活进程使用不同项目包版本，静默启动不占用户执行计数；这些是外部探针结果，不是 IDE 功能完成。

## 现有接口需要补什么

- `discover.rs` 使用 Python 绝对路径或 `ark|<executable>|<r_home>`；`parse_selection` / `encode_ark` 无 project root、profile 或 bootstrap 身份。不要继续向 pipe 字符串追加字段；现有字符串格式还无法无歧义编码包含 pipe 的 Ark 可执行路径。
- B0 `NotebookKernelSession { id, token, selection, language }` 的 token 代表实际会话 generation。前端 `session.ts` 只比较 selection 不足以发现同一 R_HOME 的不同 renv 项目。
- `ops/notebook.rs::project_environment` 按 near 所属最长 workspace member 选根，否则用 window project root；它是 metadata 提示，不是启动授权。当前使用路径前缀匹配，启动前须规范化后重新解析。
- Console `openide-console:<key>` 生成 window 根下的内存 notebook 路径。`ConsoleView` 详情无 near，runtime 只含 selection/name/language。多 member Console 不能直接从这个合成路径推断用户目标项目。
- 当前 `KernelRuntime` 的相等比较决定复用；Dap/Lsp 请求也解析 selection 并核对 runtime。新环境必须同时进入执行、启动、重启及服务的身份校验，不能只改 Start 按钮。

## 建议最小类型（设计草案，非已冻结 IPC）

保留旧 selection 入口作为 plain 模式适配器，新入口使用结构化对象；旧行为不静默升级为 renv。Rust 类型为权威，生成 bindings，不手改生成文件。

```ts
type KernelLaunch =
  | { kind: "python"; executable: string }
  | {
      kind: "ark";
      executable: string;
      rHome: string;
      environment:
        | { kind: "plain" }
        | {
            kind: "renv";
            projectRoot: string;
            profile: null; // 首片仅默认 profile，不能忽略非默认请求
            bootstrapLibrary: string;
            bootstrapVersion: string;
          };
    };
```

UI 提交期望配置；host 验证路径、归属与 trust，生成不可变 `ResolvedLaunch`，含上述规范化字段、初始 cwd、host/window 所属项目身份、renv ROOT/CACHE/SANDBOX 的绝对路径、启动策略版本与明确的 profile。缓存目录由 host 选择，不信任任意客户端传入的根路径。bootstrap 先支持用户明确选择的已有库：使用 `requireNamespace("renv", lib.loc=..., quietly=TRUE)` 加载指定 namespace 并验证版本/来源路径；不从任意 inherited library 偷选版本，不在启动时安装。

`launchId` 为 host 对规范化启动配置的稳定摘要/不透明标识（非信任凭证），`token` 继续是每次真实进程 generation。文档 id 标识 Notebook/Console，三者不能互换。同一文档仅允许完整 launchId 相同的健康会话复用；配置不同返回需要重启，不热切换项目。跨文档不共享 kernel，即使 launchId 相同。环境变量敏感值不能返回给 UI 或写入日志；首片采用固定政策，不开放任意 env 字典。

旧字符串的 `selection` 可继续回传给旧消费者，但不是 renv 会话唯一标识。renv 模式的 execute/start/service 调用必须走新 launchId/token 合同；若旧 API 尝试操作现有 renv 会话，应拒绝身份不足的请求，不能默认当 plain。后续 B1 capability/debug 事件沿用同一 token 失效规则。

## 项目根与 cwd

1. Notebook 用已注册文档实际路径解析，不把客户端 near 当真实文档身份；canonicalize 文件父路径、window root 和已配置 members，选择包含文档的最长 member，否则仅在属于 window root 时使用 window root。外部文档没有自动 renv 目标，必须显式绑定受信项目；不向父目录无限找 marker。
2. 显式 projectRoot 必须属于当前窗口已配置的根/member，或经现有项目打开/信任流程加入；不能因请求中有字符串就执行其 settings.R。拒绝路径别名逃逸及不可访问根；文件系统可变，不能把一次 canonicalize 宣称为安全沙箱。
3. metadata 缺 marker 不能启动自动 init；最小模式要求项目已有 renv 目录和 lockfile，并有可用 bootstrap。该限制是产品首片范围，不是 renv API 的一般限制。
4. Notebook cwd 保持文档父目录，renv 项目根单独传给 load。新 Console 明确选择 workspace member，持久绑定其根及初始 cwd；给 open_console 增加经过 host 校验的 root 选择，不能继续从 window 根合成路径推导另一个 member 的 cwd。
5. Console 创建后不随活动编辑器、默认解释器或 workspace member 选择变化。关闭/切换项目走既有生命周期清理，旧 token 的输出不得进入新 Console。无当前项目时 renv 模式不可用，plain 不受此限制。

## 进程与激活政策

保留 `--vanilla`、显式 R_HOME。host 在启动前清除继承的 `RENV_PROJECT`、`RENV_PROFILE` 及会影响库根/用户 profile 的 renv 配置，再写入明确政策；列出配置白名单并测污染环境，不声称清理后可信项目不会重新设置它们。最小策略为 default profile、固定 ROOT/CACHE/SANDBOX、关闭用户 profile/environ、自动 snapshot/update/synchronized 检查，cache 是否启用作为固定版本化策略；项目库仍在用户已选项目中。

缓存建议放当前 host 的应用数据根下（远端 host 使用远端目录），例如 `renv/v1/<R-platform-version>/<bootstrap-version>/{root,cache,sandbox}`。不要放 ephemeral kernel 目录，避免后续会话库 symlink 指向已删除缓存。首片禁用 package cache 可简化生命周期，但 sandbox 仍需显式配置；用户 home 的默认 sandbox 是前次真实探针已发现的问题。

新进程连接就绪后，在既有单一 transport reader 的 startup 阶段串行执行 bootstrap/load/验证。B1 合并后扩展 readiness，不能另开 reader，也不能在已有用户会话中 `renv::load` 切项目。初始化 `silent=true, store_history=false, allow_stdin=false`，等待匹配 reply 与 idle；错误/取消/超时销毁本次半启动进程，获取已有句柄取消不得杀进程。不执行 restore/snapshot/install。`renv::load` 会执行 settings.R、读项目环境并可能写基础设施；trust 是代码执行授权，固定缓存路径不是代码隔离保证。

## 实际环境结果

建议在已校验 token 的会话查询返回 `LiveREnvironment`：`launchId`、`token`、`state`（plain/active/failed）、实际 `rHome`、`rVersion`、`cwd`、`libraryPaths[]`、`renvProject`、`renvVersion`、`profile`、时间戳与有限诊断。启动失败不返回有效 active handle；错误放启动结果而非伪造会话。

取值来自进程的 `R.home()`、`getRversion()`、`getwd()`、`.libPaths()`、`renv::project()`、`packageVersion("renv")`；profile 首片固定 null 并验证没有 inherited profile 生效。通过关联请求的结构化结果通道传输，避免从普通用户 stdout 搜索 marker 当可信数据。无需为 JSON 序列化隐式安装包：可选受控 `user_expressions` 或已有 comm 数据编码，但必须先实测 Ark 对所选协议的支持。

host 核对实际 R_HOME、project、主库路径及预期配置；不能只看 load 返回 ok。允许库包含 renv sandbox 等正常附加项，返回全部实际库便于解释。active 不等于 lockfile 同步；运行中用户可以 setwd/改库，重新查询应显示实际值和偏离，而不是永久缓存启动时快照。不要每次执行重新 load。

## 显式操作与验收顺序

UI 在现有环境详情提供“使用此项目的 renv 环境”动作（英文/中文 catalog + actions 注册），展示目标 root、R_HOME、bootstrap 与“将执行项目设置并可能写库/缓存”。当前已有 trusted project 时，点击动作即明确操作，不反复要求同一授权。未信任走现有 host trust 流程。运行中改变环境提示需要重启；新 Console 的选项仅影响新 Console。检测 marker、展开详情及后台刷新始终只读。

先完成纯 host/类型合同，再串行 process/transport，再 Notebook 与 Console 接线，最后实际 UI 验收：

| 层次      | 必测差异                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 路径/身份 | 两个 member 同 R_HOME 不同 root；嵌套 notebook；symlink 规范化；外部文件拒绝自动绑定；同 launch 不同 token；特殊字符结构化编码 |
| 兼容      | 原 Python 与 plain Ark 字符串行为不变；旧 API 不能绕过 renv 身份校验；Console 默认变化不改已有会话                             |
| 启动      | 缺 bootstrap、错误版本、缺项目、settings.R 抛错、污染 inherited RENV_PROFILE、取消/超时无孤儿、并发启动仅一进程                |
| 真实运行  | 双项目 fixture 包 1.0.0/2.0.0；四个实际路径值正确；第一个用户 count=1；Notebook 与指定 member Console 各自隔离                 |
| 生命周期  | 同身份复用；换 root 后 restart、新 token；旧输出/LSP/DAP/capability 事件丢弃；变量/图表/断点沿用已激活进程                     |
| 副作用    | ROOT/CACHE/SANDBOX 实际均为 host 选定根；缺包不会隐式 restore/download；失败不会把 metadata 标成 active                        |

## 官方能力对应的具体后续缺口

以下来自已核对的 MIT renv 1.2.3 官方源码（固定 SHA `17bc1a76cb2faafc3da491bf955050212da80893`），是可执行的小切片，不纳入首片启动范围：

- **同步状态与 active 分离**：[status.R](https://github.com/rstudio/renv/blob/17bc1a76cb2faafc3da491bf955050212da80893/R/status.R) 区分缺包、依赖未记录、lock/library 来源或版本不同、R 版本不同。增加用户显式“检查环境同步”，分别显示这些差异；不要仅用包总数判断 reproducible，也不要在每次启动全量扫描依赖。
- **restore 预览与失败保护**：[restore.R](https://github.com/rstudio/renv/blob/17bc1a76cb2faafc3da491bf955050212da80893/R/restore.R) 默认 transactional，`clean=TRUE` 会删额外包。未来 restore 动作需给具体包变更和来源，再执行默认 transactional、`clean=FALSE`；验证本地 fixture 中恢复失败不会留下半套项目库。不得当成 load 的自动补救。
- **profile 是环境身份**：[官方 profiles 文档](https://github.com/rstudio/renv/blob/17bc1a76cb2faafc3da491bf955050212da80893/vignettes/profiles.Rmd) 支持同一项目的独立 lockfile/library。后续非默认 profile 要进 launchId、环境详情与同步/restore 目标；首片明确只支持默认，防止两个 profile 被当同一会话复用。

这些官方 API/语义已经源码核对，但以上新 UI、IPC、恢复流程与 profile 支持都尚未实现或真实验收；正式功能不能直接解析 renv 内部函数的未承诺返回结构。
