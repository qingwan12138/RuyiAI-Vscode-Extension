# Controlled Text Edit — Implementation Plan

- [x] Extend workspace read results with SHA-256 and lock the contract with tests.
- [x] Add a bounded write port and Node atomic unique-replacement adapter with boundary, sensitive-path, encoding, stale, and mode guarantees.
- [ ] Add `replace_text` with exact schema/input parsing and bounded structural results.
- [ ] Generalize the Agent loop to allow PermissionEngine-approved workspace writes and inject an explicit confirmation port.
- [ ] Add the VS Code modal confirmation adapter and wire the write tool only for one local file workspace.
- [ ] Update product/roadmap documentation with precise current limits.
- [ ] Run focused and full verification, review the diff, merge to main, rerun verification, and continue.
