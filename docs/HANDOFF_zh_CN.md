# 项目交接

<p align="center">
  <a href="HANDOFF.md">English</a> |
  <a href="HANDOFF_zh_CN.md">简体中文</a>
</p>

更新时间：2026-08-29

## 当前基线

- 仓库：`YKZStudio/MahiroFormat`
- 本次审阅基线提交：`71f3ade`（`fix(ci): audit the lockfile across platforms`）
- 包版本：`0.6.4`
- 主运行时：Electron 43，Windows 10/11 x64
- 兼容 profile：Windows 7 SP1 x64 使用隔离的 Electron 22 staging；macOS arm64/x64 使用各自架构的引擎包
- 产品身份：非官方绪山真寻同人主题；原作者牢蜂，YKZStudio 升级与维护
- 许可证：仓库非商用许可证；内置第三方组件保留各自许可证

## 当前能力与边界

- 源码当前注册了实验性的 NCM、KGG、QMC、KGMA、KWM 和 VPR 路由；Microsoft Store 构建会隐藏并拒绝这些入口。
- OFD 只暴露 PDF 目标，使用本地 `@miconvert/ofd-to-pdf` 路径，不经过 LibreOffice。
- PDF → DOCX 在 `docengine` 可用时优先使用该引擎，不可用时进入回退路径。
- 扫描/混合 PDF 的 Office 转换在打包了结构化文档引擎时使用分类与 manifest 链路；发布结果前会做结构校验。
- `bin/` 下的大型引擎通常不由 Git 跟踪。缺少这些资源的源码检出无法完成全量转换或打包验收。
- Windows 安装包未签名；macOS 包未签名且未公证；不得根据 CI 推断 Windows 7 或 Mac 真机已经验收。

## 文档状态

- `README.md` 为英文，`README_zh_CN.md` 为简体中文，开头提供语言切换链接。
- 架构、发布、交接和隐私政策同样采用英文默认文件与 `_zh_CN` / `-zh-CN` 中文文件配对。
- `docs/README.md` 与 `docs/README_zh_CN.md` 是权威文档索引。
- 版本化发行说明、商店包校验记录和 `docs/superpowers/` 下的计划/设计属于历史证据，不得改写为当前产品状态。
- 原始上游仓库是 `LaoFeng-mouse/flyingmouse-format`；除明确描述上游历史外，当前开发链接应使用 `YKZStudio/MahiroFormat`。

## 验证要求

纯文档改动至少运行：

```powershell
git diff --check
node scripts/check-docs.js
```

涉及运行时或发布时，还必须遵循[发布指南](RELEASE_zh_CN.md)，运行完整测试/审计门禁，恢复固定引擎，检查打包结果并记录精确证据。

## 待处理事项

- 当前仓库的提交与产物通过文档中的门禁后，才发布当前仓库 Release。
- 更新任何 Microsoft Store 外部状态前，必须在 Partner Center 重新现场回读。
- 只有在对应系统真机测试后，才记录 Windows 7 与 macOS 真机验收。
- 凭据、证书、私人源文件、用户文档和未脱敏诊断不得进入 Git。
