# 15 — 每次实现前后的 Checklist

## Before
- [ ] 对应 roadmap milestone 明确
- [ ] 没有改变已确认产品决定
- [ ] 依赖方向符合 Architecture Contract
- [ ] 外部参考只形成行为/设计笔记，没有复制源码
- [ ] 新依赖已做 license/Remote SSH/bundle 评估
- [ ] 涉及写入/命令/网络/secret 已定义 risk

## During
- [ ] UI 不直接执行 privileged operation
- [ ] Tool input runtime validated
- [ ] cancellation propagated
- [ ] logs redacted
- [ ] state schema versioned
- [ ] error normalized，不能吞异常

## Done
- [ ] unit/integration tests
- [ ] 用户可观察行为符合 DoD
- [ ] completion 有 validation evidence
- [ ] docs/ADR 更新（若边界变化）
- [ ] dependency notice 更新
- [ ] 没有把临时 workaround 变成 core coupling
