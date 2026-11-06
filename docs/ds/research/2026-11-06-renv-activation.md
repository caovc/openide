# renv 显式激活：真实探针与下一步接线

日期：2026-11-06。代码基线：`26406df`。范围：DS-04B 后续 R 项目环境激活。

**结论：R 4.5.0 + Ark 0.1.252 可以在静默初始化中通过公开 API 激活两个互相隔离的 renv 项目，并保持首个用户执行计数为 1。本次仅在独立临时目录使用 JupyterClient 验证；OpenIDE 尚未接入这条激活流程。** 必须在 DS-04B0 显式启动接口落地后串行接线，不能把 metadata 的 `detected-inactive` 改名为 active。

## 来源与许可证

- 官方公开 API：[renv::load](https://rstudio.github.io/renv/reference/load.html)、[renv::project](https://rstudio.github.io/renv/reference/project.html)。
- 实测固定官方 [rstudio/renv v1.2.3](https://github.com/rstudio/renv/tree/v1.2.3)，commit `17bc1a76cb2faafc3da491bf955050212da80893`。
- MIT，Copyright 2023 Posit Software, PBC；源目录保留 `LICENSE`。研究依赖未引入产品发布物，未来分发须保留许可证。
- 从该 tag 的完整 source 安装，只安装 renv；DESCRIPTION 的 Imports 为 utils，未安装 Suggests 或 restore 项目依赖。

固定版本源码核对：[load.R](https://github.com/rstudio/renv/blob/17bc1a76cb2faafc3da491bf955050212da80893/R/load.R)、[project.R](https://github.com/rstudio/renv/blob/17bc1a76cb2faafc3da491bf955050212da80893/R/project.R)、[paths.R](https://github.com/rstudio/renv/blob/17bc1a76cb2faafc3da491bf955050212da80893/R/paths.R)。

## 当前实现边界

- `crates/ide-notebook/src/environment.rs` 只读取显式项目目录的 marker/lockfile。lockfile 的 R.Version 不表示已安装 R，存在 activate.R 不表示已激活。
- `kernel/process.rs` 使用显式 R_HOME，Ark 参数为 `--session-mode notebook --default-repos none -- --interactive --vanilla`，cwd 为 notebook 父目录。
- `kernel/transport.rs::initialize_variables` 已有 Python 静默初始化与单一消息分发循环。renv 初始化应进入同一启动 readiness 流程，完成后才允许用户执行/变量服务；不可另开竞争读取 shell/IOPub 的任务。
- B0 协调接口为 `KernelManager::ensure_started(path, runtime, cancel) -> KernelComms` 与 host 的 `notebook_start_kernel(id, selection, request) -> NotebookKernelSession`。项目激活字段与运行身份扩展须基于 B0 最终合并版本实施，此文不修改接口。

## load 的副作用与可信项目边界

`renv::load(project = explicit_root, quiet = TRUE)` 是执行可信项目启动逻辑，而非只读探测：

- 读取项目 `.Renviron`；`renv/settings.R` 会被 `eval(parse(...))` 执行。本探针创建的 settings.R 实际写出了 marker。
- 可读取 profile 配置、调整环境变量、库路径、sandbox/cache；可能写项目 `.gitignore`、`.Rbuildignore` 及 renv 基础设施。
- 本次全新进程、关闭 user profile/environ 的配置下，故意包含 `stop()` 的项目 `.Rprofile` 与 `renv/activate.R` 没被执行。**这不保证所有 load 模式不执行它们**：源码 `renv_load_switch` 在同一进程切换项目时会 source 新项目 activate.R。
- `renv::load(project=...)` 不把 cwd 永久切到 project_root。本探针 cwd 保持 `<project>/notebooks`，`renv::project()` 返回项目根；两者必须分别展示和验证。
- `RENV_PATHS_SANDBOX` 不随 `RENV_PATHS_ROOT` 自动迁移，必须单独配置。仅设置 ROOT/CACHE 不足以保证所有写入都位于预期根目录。

后续 UI 应在用户显式选择可信项目环境时说明“加载项目 renv 设置，可能执行项目代码并写入项目库/缓存”。打开项目、发现 lockfile 或查看环境列表均不得触发 load。对已选择的同一运行身份复用启动结果；切换 project_root/R_HOME/renv 配置必须启动新进程或显式 restart，不在现有进程内切换项目。

## 独立真实探针

本机证据目录：`/workspace/work/renv-activation-probe`。可重跑入口为 `probe.py`，先 source `/workspace/work/ds-runtime/env.sh`，再用 `$OPENIDEA_TEST_PYTHON` 执行；脚本与运行日志是本机研究产物，未加入产品仓库。

初始 R 运行库没有安装 renv。安装命令：

```sh
R CMD INSTALL --no-test-load --no-multiarch \
  --library=/workspace/work/renv-activation-probe/library \
  /workspace/work/renv-activation-probe/source
```

探针只创建、加载自有 `project-a` 与 `project-b`，不触碰用户项目或系统包库。启动参数与产品 Ark notebook 路线一致，两个 Ark 同时存活。每个项目装入自行编写的纯 R fixture 包 `openideenvmarker`，版本分别为 1.0.0/2.0.0，无下载依赖。

最终探针显式配置以下路径，全部位于 `/workspace/work/renv-activation-probe`：

| 配置                   | 相对路径                    |
| ---------------------- | --------------------------- |
| bootstrap renv library | `library`                   |
| RENV_PATHS_ROOT        | `renv-root`                 |
| RENV_PATHS_CACHE       | `cache`                     |
| RENV_PATHS_SANDBOX     | `sandbox`                   |
| 项目及项目库           | `project-a`、`project-b` 下 |

关闭 `RENV_CONFIG_USER_PROFILE`、`USER_ENVIRON`、`AUTO_SNAPSHOT`、`UPDATES_CHECK`、`SYNCHRONIZED_CHECK`、`CACHE_ENABLED`（均以 `RENV_CONFIG_` 为前缀）。这只是受控 fixture 配置，不构成任意项目不会执行代码或写其他路径的保证；项目设置仍属于可信代码。

初始化以 `silent=true, store_history=false, allow_stdin=false` 执行：

```r
.libPaths(c(bootstrap_library, .libPaths()))
stopifnot(requireNamespace("renv", quietly = TRUE))
renv::load(project = explicit_root, quiet = TRUE)
```

最终 `result.json` / `probe.log` 记录：

| 检查                     | 项目 A                                      | 项目 B                |
| ------------------------ | ------------------------------------------- | --------------------- |
| Ark PID                  | 170681                                      | 170745                |
| R.home()                 | `/workspace/work/ds-runtime/root/usr/lib/R` | 同左                  |
| getwd()                  | `project-a/notebooks`                       | `project-b/notebooks` |
| renv::project()          | `project-a` 根目录                          | `project-b` 根目录    |
| .libPaths()[1]           | A 独有 renv/library                         | B 独有 renv/library   |
| fixture 包版本/返回值    | 1.0.0 / project-a                           | 2.0.0 / project-b     |
| 首次可见 execution_count | 1                                           | 1                     |

表内项目路径均相对于证据目录。项目库的完整后缀为 `renv/library/linux-debian-trixie/R-4.5/x86_64-pc-linux-gnu`；第二项库路径是受控 `sandbox/linux-debian-trixie/R-4.5/x86_64-pc-linux-gnu/03d595c3`。B 启动后再次在 A 检查，仍得到 A 的 1.0.0，隔离 PASS；两个 kernel 在 finally 中关闭。

第一轮发现 sandbox 默认写到 home cache，已仅删除可证明由本探针创建的精确 sandbox 叶目录，保留祖先与其他目录；补充 `RENV_PATHS_SANDBOX` 后重跑，以上均为最终结果。这个发现应成为产品启动配置的回归检查。

## 下一最小实现与验收

1. B0 合并后，为 R launch selection 增加显式可信项目 renv 模式，保留 plain R；保存规范化 project_root、R_HOME、明确的 renv bootstrap 来源及受控 ROOT/CACHE/SANDBOX 配置。所有影响启动的字段进入会话运行身份，防止复用错误项目的 kernel。
2. 在新 Ark 的 startup readiness 内静默调用 load；无 renv、未初始化项目、版本不匹配、load 出错/取消/超时均明确返回错误并清理半启动进程。禁止静默自动安装、restore 或改用另一个 R。仅有 lockfile、无可加载 renv 项目目录时不触发可能交互询问的初始化。
3. 从实际进程返回 `R.home()`、`getwd()`、`.libPaths()`、`renv::project()` 和 renv 版本，规范化后验证目标项目与库身份。active 仅表示本会话激活成功，不表示 lockfile 完整恢复或包版本全匹配；元数据状态与 live runtime 状态分开。
4. 补正式自动化验收：两项目不同包版本的隔离、嵌套 notebook cwd、缺 renv/缺项目/失败 settings.R、取消/超时清理、同身份复用、身份变化后的 restart 与旧事件隔离、首个用户计数不被初始化占用。路径用结构化字符串编码，不拼接未转义 R 源码。
5. 实际 IDE Notebook/Console 执行与重启后核对上述四个运行值，再验收变量/图表/调试复用同一环境。此次未测 IDE 接线、UI、restart/cancel、项目 restore、包管理、R 调试或跨平台运行，不能勾选这些项完成。
