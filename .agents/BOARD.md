# DS 协作状态板

Canonical：`/workspace/openide/.agents/BOARD.md`；仅 **OpenIDE大师** 更新。认领流程、路径所有权与交接格式见 [COLLAB](../docs/ds/COLLAB.md)。状态：`pending` / `in_progress` / `done` / `blocked`。

分支名为预留计划，不表示已创建。里程碑可 commit/push（防丢失）；未完成真实验证不得标 done。云端 Codex 交接：`docs/ds/HANDOFF-CLOUD-CODEX.md`。

基线上游 HEAD `ba9ce1d8`；工作树含 U1–U9.2a（未合入上游）。路径隔离并行，不用 worktree。

<<<<<<< Updated upstream
| unit   | status      | owner                     | branch                  | notes                                                                                                                                                                                                                                                     |
| ------ | ----------- | ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1     | done        | OpenIDE大师               | `ds/u1-ark-headless`    | VERIFIED：`ark_smoke` 得 42 + LSP completion `openide_smoke` + 无残留。证据 `.audit/u1-*`。未改 UI / r.toml。                                                                                                                                             |
| U2     | done        | OpenIDE大师               | `ds/u2-runtime-comm`    | VERIFIED：KernelRuntime Python/Ark + generation-bound comm API；证据 `.audit/u2-*`。                                                                                                                                                                      |
| U3     | done        | OpenIDE大师               | `ds/u3-kernel-select`   | VERIFIED：detect_ark + kernel Select；证据 `.audit/u3-*`。                                                                                                                                                                                                |
| U4     | done        | OpenIDE大师               | `ds/u4-ark-session-lsp` | VERIFIED：SessionLsp；证据 `.audit/u4-*`。                                                                                                                                                                                                                |
| U5     | done        | OpenIDE大师               | `ds/u5-ark-dap-stdin`   | VERIFIED：ark_dap + stdin；证据 `.audit/u5-*`。                                                                                                                                                                                                           |
| Java-A | done        | OpenIDE大师               | —                       | 软藏 VERIFIED：默认隐藏 JVM 语言/运行/调试/设置；`OPENIDE_JVM=1 VITE_OPENIDE_JVM=1` 诊断恢复。证据 `.audit/java-soft-hide.md` / `java-verification.tsv`。未硬删。                                                                                         |
| U6     | done        | OpenIDE大师               | `ds/u6-session-vars`    | VERIFIED runtime：共用 Variables/Plots；R+Python 真实会话隔离/重启清空；Python 7 + Ark 5 + session 3 + 前端 65 绿。证据 `.audit/u6-report.md` / `u6-verification.tsv`。GUI/截图未验；SAS adapter 接口已留。                                               |
| U7     | done        | OpenIDE大师               | `ds/u7-console`         | VERIFIED host/API：Python+Ark 真实执行保留状态=42、双 Console 隔离、stdin、restart/close、无 .ipynb、runtime 目录清空。前端 13 + host 10 单测绿。证据 `.audit/u7-report.md` / `u7-real-*-coord.log`。GUI/截图未验。U8 契约见报告 `ds.console.*` actions。 |
| U8     | done        | OpenIDE大师               | `ds/u8-editor-run`      | VERIFIED unit/DOM：选区/当前缓冲区 → 明确同语言 Console；picker/create、stale/mismatch/busy 拒绝、Stop；55 测 + typecheck 绿。证据 `.audit/u8-report.md`。原生 GUI/真实 Editor→kernel 未验（清单在报告）。                                                |
| U9     | in_progress | OpenIDE大师 / Cloud Codex | `ds/u9-data-explorer`   | U9.1 done；**U9.2a Ark smoke PASS**（`ark_explorer` ignored 测绿，broker=`crates/ide-notebook/src/ark_explorer.rs`）。待补 u9-2-report 与 UI/dbx 移植。交接见 `docs/ds/HANDOFF-CLOUD-CODEX.md`。dbx=t8y2/dbx。                                            |
| U10    | pending     | —                         | —                       | Windows SAS（后置）。                                                                                                                                                                                                                                     |
| U11    | pending     | —                         | —                       | Later：JVM 硬删除（阶段 B）。                                                                                                                                                                                                                             |
| U12    | pending     | —                         | —                       | Python / R 包可视化管理（能力差异分别支持）；R 另含包文档浏览。                                                                                                                                                                                           |
=======
| unit | status | owner | branch | notes |
| --- | --- | --- | --- | --- |
| U1 | done | OpenIDE大师 | `ds/u1-ark-headless` | VERIFIED：`ark_smoke` 得 42 + LSP completion `openide_smoke` + 无残留。证据 `.audit/u1-*`。未改 UI / r.toml。 |
| U2 | done | OpenIDE大师 | `ds/u2-runtime-comm` | VERIFIED：KernelRuntime Python/Ark + generation-bound comm API；证据 `.audit/u2-*`。 |
| U3 | done | OpenIDE大师 | `ds/u3-kernel-select` | VERIFIED：detect_ark + kernel Select；证据 `.audit/u3-*`。 |
| U4 | done | OpenIDE大师 | `ds/u4-ark-session-lsp` | VERIFIED：SessionLsp；证据 `.audit/u4-*`。 |
| U5 | done | OpenIDE大师 | `ds/u5-ark-dap-stdin` | VERIFIED：ark_dap + stdin；证据 `.audit/u5-*`。 |
| Java-A | done | OpenIDE大师 | — | 软藏 VERIFIED：默认隐藏 JVM 语言/运行/调试/设置；`OPENIDE_JVM=1 VITE_OPENIDE_JVM=1` 诊断恢复。证据 `.audit/java-soft-hide.md` / `java-verification.tsv`。未硬删。 |
| U6 | done | OpenIDE大师 | `ds/u6-session-vars` | VERIFIED runtime：共用 Variables/Plots；R+Python 真实会话隔离/重启清空；Python 7 + Ark 5 + session 3 + 前端 65 绿。证据 `.audit/u6-report.md` / `u6-verification.tsv`。GUI/截图未验；SAS adapter 接口已留。 |
| U7 | done | OpenIDE大师 | `ds/u7-console` | VERIFIED host/API：Python+Ark 真实执行保留状态=42、双 Console 隔离、stdin、restart/close、无 .ipynb、runtime 目录清空。前端 13 + host 10 单测绿。证据 `.audit/u7-report.md` / `u7-real-*-coord.log`。GUI/截图未验。U8 契约见报告 `ds.console.*` actions。 |
| U8 | done | OpenIDE大师 | `ds/u8-editor-run` | VERIFIED unit/DOM：选区/当前缓冲区 → 明确同语言 Console；picker/create、stale/mismatch/busy 拒绝、Stop；55 测 + typecheck 绿。证据 `.audit/u8-report.md`。原生 GUI/真实 Editor→kernel 未验（清单在报告）。 |
| U9 | in_progress | OpenIDE大师 / Cloud Codex | `ds/u9-data-explorer` | U9.1 done；**U9.2a Ark smoke PASS**（`ark_explorer` ignored 测绿，broker=`crates/ide-notebook/src/ark_explorer.rs`）。待补 u9-2-report 与 UI/dbx 移植。交接见 `docs/ds/HANDOFF-CLOUD-CODEX.md`。dbx=t8y2/dbx。 |
| U10 | pending | — | — | Windows SAS（后置）。 |
| U11 | pending | — | — | Later：JVM 硬删除（阶段 B）。 |
| U12 | pending | — | — | Python / R 包可视化管理（能力差异分别支持）；R 另含包文档浏览。 |
>>>>>>> Stashed changes
