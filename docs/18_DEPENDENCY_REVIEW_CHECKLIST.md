# 18 — Dependency Review Checklist

Before `npm install <new-package>` for production code:

- [ ] Existing VS Code API cannot reasonably provide the capability.
- [ ] Node.js standard library cannot reasonably provide it.
- [ ] Package purpose is documented.
- [ ] Package is actively maintained.
- [ ] License is identified and compatible with closed-source delivery.
- [ ] No unexpected copyleft obligation.
- [ ] Native binary/addon status checked.
- [ ] Transitive dependency weight checked.
- [ ] Security/advisory status checked.
- [ ] Browser/Webview vs Extension Host placement decided.
- [ ] Package types do not leak across architecture boundaries.
- [ ] Alternative pure TS/JS packages considered.
- [ ] Offline/enterprise installation impact considered.
- [ ] THIRD_PARTY_NOTICES / dependency inventory updated when required.

If native or a second runtime is involved:
- [ ] Stop normal implementation.
- [ ] Create an ADR.
- [ ] Obtain architecture approval before adding it.
