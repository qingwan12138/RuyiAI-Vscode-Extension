# 14 — Dependency / License Policy for Closed-Source Delivery

## 默认政策
- 优先 VS Code/Node 标准能力和成熟、窄职责依赖。
- 新增 runtime dependency 必须说明：用途、替代方案、license、维护状态、bundle 影响、Remote SSH/native 风险。
- Apache-2.0/MIT/BSD 等通常可评估使用，但必须履行 attribution/NOTICE 等义务；不是“随便复制源码”。
- GPL/AGPL/SSPL/未知/自定义限制许可证默认禁止进入 runtime/bundle，除非项目负责人/甲方/法务批准。
- devDependency 同样登记，但交付义务按实际分发内容审计。

## 参考项目与依赖不同
Cline/Codex/Aider 等可以是“研究参考”，不等于 npm/cargo dependency。不要因为其开源就把其内部 package 直接 vendoring。

## 交付文件
维护：
- `THIRD_PARTY_NOTICES.md`
- dependency lockfile
- license scan report
- SBOM（RC 阶段建议生成）

## 禁止
- 从 GitHub 复制一个文件后删版权头。
- 把参考项目 prompt/测试快照/图标/字体/品牌资源搬进闭源项目。
- 使用来源不清晰的代码片段。
