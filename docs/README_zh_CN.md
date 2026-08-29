# 文档索引

<p align="center">
  <a href="README.md">English</a> |
  <a href="README_zh_CN.md">简体中文</a>
</p>

本索引将当前文档与历史证据分开。除“当前参考”中列出的文件外，其他文档不能直接视为当前产品或发布状态。

## 当前参考

| 主题 | English | 简体中文 |
|---|---|---|
| 项目概览 | [README](../README.md) | [README](../README_zh_CN.md) |
| 架构与安全边界 | [Architecture](ARCHITECTURE.md) | [架构说明](ARCHITECTURE_zh_CN.md) |
| 发布流程 | [Release guide](RELEASE.md) | [发布指南](RELEASE_zh_CN.md) |
| 运维交接 | [Project handoff](HANDOFF.md) | [项目交接](HANDOFF_zh_CN.md) |
| 隐私政策 | [Privacy policy](privacy-policy.html) | [隐私政策](privacy-policy-zh-CN.html) |

仓库根目录的 [AGENTS.md](../AGENTS.md) 包含面向自动化维护者的强制约束。[LICENSE](../LICENSE) 是具有约束力的中英双语许可证，特意保留在同一文件中，不做拆分。

## 用户与分发指南

- [特殊音乐格式兼容说明](特殊音乐格式兼容说明.md)：实验性兼容、凭据、密钥与合法使用边界。
- [酷狗 KGG 密钥库手动指定教程](酷狗KGG密钥库手动指定教程.md)：手动查找并指定 `KGMusicV3.db`。
- [分发与合规规范](分发与合规规范.md)：公开文案、署名、分发和商店边界。
- [Microsoft Store 上架清单](微软商店上架清单.md)：商店流程和历史现场状态。
- [上架材料包](上架材料包.md)：历史商店材料；复用前必须重新核对版本、哈希和状态。

## 历史发行记录

版本化文件保留相应版本当时的说明或测量结果，不会为了匹配当前功能而重写。

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
- [v0.3.6 Microsoft Store 包校验](v0.3.6-商店上传校验.md)
- [v0.5.0 Microsoft Store 包校验](v0.5.0-商店上传校验.md)

历史记录可能包含后来已变化的功能、界面素材、许可证、文件名、仓库地址或外部服务状态。

## 工程归档

[`superpowers/specs/`](superpowers/specs/) 和 [`superpowers/plans/`](superpowers/plans/) 保存 2026 年 8 月的设计决策与实施计划，其中包含历史命令、路径、提交 ID、版本假设和任务复选框。它们用于理解设计理由和审计，不能直接作为当前操作说明。

## 文档约定

- 无语言后缀的公共文档默认使用英文。
- 简体中文 Markdown 使用 `_zh_CN.md`，HTML 使用 `-zh-CN.html`。
- 成对文档在开头提供语言切换链接。
- 当前仓库链接使用 `YKZStudio/MahiroFormat`；指向 `LaoFeng-mouse/flyingmouse-format` 时必须标明原项目或历史用途。
- 外部商店/认证状态必须包含日期和核验方式。
- 版本化记录原则上保留；会改变历史含义的修正必须显式注明勘误。

编辑文档后运行 `npm run docs:check`。
