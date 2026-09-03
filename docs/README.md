# Documentation

<p align="center">
  <a href="README.md">English</a> |
  <a href="README_zh_CN.md">简体中文</a>
</p>

This index separates current documentation from historical evidence. Unless a document is listed under **Current references**, it should not be treated as the present product or release state.

## Current references

| Topic | English | Simplified Chinese |
|---|---|---|
| Project overview | [README](../README.md) | [README](../README_zh_CN.md) |
| Architecture and security boundaries | [Architecture](ARCHITECTURE.md) | [架构说明](ARCHITECTURE_zh_CN.md) |
| Release procedure | [Release guide](RELEASE.md) | [发布指南](RELEASE_zh_CN.md) |
| Operational handoff | [Project handoff](HANDOFF.md) | [项目交接](HANDOFF_zh_CN.md) |
| Performance review and checks | [Performance](PERFORMANCE.md) | [性能审阅](PERFORMANCE_zh_CN.md) |
| Privacy policy | [Privacy policy](privacy-policy.html) | [隐私政策](privacy-policy-zh-CN.html) |

The repository-level [AGENTS.md](../AGENTS.md) contains maintainer constraints for automated contributors. [LICENSE](../LICENSE) is bilingual and legally controlling; it is intentionally not split.

## User and distribution guides

These guides are currently maintained in Chinese because they target specific local workflows:

- [特殊音乐格式兼容说明](特殊音乐格式兼容说明.md) — experimental compatibility, credentials, keys, and legal-use boundaries.
- [酷狗 KGG 密钥库手动指定教程](酷狗KGG密钥库手动指定教程.md) — manually locating `KGMusicV3.db`.
- [分发与合规规范](分发与合规规范.md) — public wording, attribution, distribution, and Store boundaries.
- [Microsoft Store 上架清单](微软商店上架清单.md) — Store process and historically observed external state.
- [上架材料包](上架材料包.md) — historical Store listing materials; verify every version, hash, and status before reuse.

## Historical release records

Versioned files preserve what was stated or measured for that release. They are not updated to match the current feature set.

- [v0.3.5 English](releases/v0.3.5.md) / [简体中文](releases/v0.3.5_zh_CN.md)
- [v0.3.9](release-notes-039.md)
- [v0.4.0](release-notes-040.md)
- [v0.4.1](release-notes-041.md)
- [v0.5.0](release-notes-050.md)
- [v0.5.1](release-notes-051.md)
- [v0.5.2](release-notes-052.md)
- [v0.6.0](release-notes-060.md)
- [v0.6.1](release-notes-061.md)
- [v0.6.2](release-notes-062.md)
- [v0.6.3](release-notes-063.md)
- [v0.6.4](release-notes-064.md)
- [v0.3.6 Microsoft Store package validation](v0.3.6-商店上传校验.md)
- [v0.5.0 Microsoft Store package validation](v0.5.0-商店上传校验.md)

Historical notes may describe features, UI artwork, licenses, filenames, repositories, or external service states that later changed.

## Archived engineering records

The files under [`superpowers/specs/`](superpowers/specs/) and [`superpowers/plans/`](superpowers/plans/) capture design decisions and implementation plans from August 2026. They contain historical commands, paths, commit IDs, version assumptions, and task checkboxes. Use them as rationale and audit evidence, not as current instructions.

## Documentation conventions

- The default unsuffixed public document is English.
- Simplified Chinese variants use `_zh_CN.md` for Markdown and `-zh-CN.html` for HTML.
- Paired documents include language links at the top.
- Current-repository links use `YKZStudio/MahiroFormat`; upstream links to `LaoFeng-mouse/flyingmouse-format` are labeled as historical/original.
- External Store or certification status always includes the date and how it was verified.
- Versioned records are preserved; corrections that change historical meaning require an explicit erratum.

Run `npm run docs:check` after editing documentation.
