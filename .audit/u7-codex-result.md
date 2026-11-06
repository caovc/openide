Implemented U7 Console MVP locally. **Real runtime acceptance remains blocked**, so it is not marked fully verified.

- Added Python/R selection, isolated consoles, execution history, stdin/password replies, cancellation, restart and close.
- Passed: 13 frontend tests, 10 host tests, typecheck, focused lint/format and host-only strict Clippy.
- Python/Ark smoke attempts failed before launch because local sockets return `EPERM`. Desktop verification lacked an MCP bridge. Mock tests are not runtime proof.
- Shared catalog failure is U6’s missing “Plots” translation; Console labels reuse existing translations.

No commit, push, branch/worktree changes or `ide-notebook` edits.

<<<<<<< Updated upstream
[Report and U8 API contract](/workspace/openide/.audit/u7-report.md) · [Verification evidence](/workspace/openide/.audit/u7-verification.tsv) · [Change inventory](/workspace/openide/.audit/u7-change-inventory.log)
=======
[Report and U8 API contract](/workspace/openide/.audit/u7-report.md) · [Verification evidence](/workspace/openide/.audit/u7-verification.tsv) · [Change inventory](/workspace/openide/.audit/u7-change-inventory.log)
>>>>>>> Stashed changes
