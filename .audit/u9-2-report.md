# U9.2a report — Ark data explorer → TableProvider (thin)

**结论（2026-11-06 Asia/Shanghai）：** ignored 集成测 `ark_view_schema_page_and_restart_rejection` **PASS**。本地 Codex API 403 后改手写/直实现；正式 GUI / dbx 未做。交接见 `docs/ds/HANDOFF-CLOUD-CODEX.md`。

## Delivered

- `crates/ide-notebook/src/ark_explorer.rs` — broker：`positron.variables` view → `positron.dataExplorer` → get_state / get_schema / get_data_values
- `crates/ide-notebook/tests/ark_explorer.rs` — ignored smoke
- `src/features/ds-data-explorer/ark.ts` (+ `ark.test.ts`) — wire → U9.1 shapes

## Smoke

```bash
PATH=$HOME/.cargo/bin:/workspace/mamba/envs/r/bin:$PATH \
OPENIDE_ARK=/workspace/ark/target/release/ark R_HOME=/workspace/mamba/envs/r/lib/R \
cargo test -p ide-notebook --test ark_explorer -- --ignored --nocapture --test-threads=1
```

Observed: rows=3 cols=6；NA/NaN/Inf/-Inf codes；restart rejects stale generation.

## Next

U9.2 report hygiene / BOARD；dbx canvas React port；U9.2b Python；HTML widgets。

## Out of scope this slice

GUI；npm 新依赖；生产 host IPC 授权；Python adapter；U12 impl。
