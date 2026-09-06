# Mahiro Format v0.6.5

[English](release-notes-065.md) | [简体中文](release-notes-065_zh_CN.md)

基于 YKZStudio/MahiroFormat 当前主分支构建，包含真寻同人主题、中英文界面及近期性能优化。

- 图片转 PDF 改用流式输出，降低内存峰值。
- 合并重复的引擎能力探测，减少批量界面重绘。
- 在本机转换文档、图片、PDF、音视频、电子书和 ZIP，支持批量处理与结果预览。
- 沿用当前 Mahiro 角色素材、主题与应用图标。
- 发行标签绑定实际测试的提交；各平台构建、转换测试及依赖审计全部通过后才发布，并附 SHA256SUMS.txt 校验文件。

按系统选择 Windows 10/11 x64 标准安装包、独立的 Windows 7 SP1 x64 兼容安装包，或 macOS arm64/x64 DMG。Windows 包未签名；macOS 包未签名、未公证。自动构建检查不等于真实设备验收；真实 Win7 与 Mac 设备仍待验收。Win7 包不含标准 Windows 版的文档引擎。

特殊音乐容器兼容仍属实验性功能，受本机密钥、凭据、容器变体及平台限制影响。请保留源文件并复核结果；Microsoft Store 版排除这些功能。本次发行不向 Microsoft Store 发布安装包。

原作者：**牢蜂（LaoFeng）**；Mahiro Format 升级与维护：**YKZStudio**。

非官方绪山真寻同人主题，与原作权利方不存在官方授权、合作或从属关系。仅供个人免费使用，禁止商业售卖/转卖/套壳。第三方组件保留各自许可证。
