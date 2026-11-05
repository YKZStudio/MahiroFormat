# Mahiro Format v0.8.4

[English](https://github.com/YKZStudio/MahiroFormat/blob/v0.8.4/docs/release-notes-084.md) | [简体中文](https://github.com/YKZStudio/MahiroFormat/blob/v0.8.4/docs/release-notes-084_zh_CN.md)

同步原始上游 `LaoFeng-mouse/flyingmouse-format` 至提交 `f7d9eab18e91848f9740261d348717bae3f40c21`（0.8.4），保留 Mahiro 品牌、真寻同人素材、中英文界面与现有源码目录。

- 修复 Office 在深层临时目录、长中文文件名下转换失败；使用短路径独占工作区，保留用户文件名和清理归属。
- 合入 PDF、OFD、Excel 还原修复，改善插图、文字顺序、表格、字体处理，并拒绝损坏或伪装输入。
- 显示真实转换阶段、已耗时间，改善取消与临时结果释放；保存文件和 Markdown 附件失败时保护用户原有文件。
- 改善 ICO 图标、普通音视频、EPUB 生成，增加文本编码选择。
- 更新锁定依赖和兼容补丁，同步固定摘要的结构化文档引擎、Markdown 引擎及 CR2 解码器准备流程。
- 保留 Mahiro 图标、原作者与维护者署名、本地会话令牌和沙箱、独立 Win7 构建。图片按可用内存准入，且不超过 50MP/单边 16384px；图片合并 PDF 总预算 100MP，批量输入 2GiB；PDF/OCR 不静默丢页。

通用“任意文件转 ZIP”与文件夹压缩跟随上游移除，压缩包转 PDF 工作流保留。Mahiro 原有特殊音乐容器实验性兼容继续保留，商店运行时隐藏并拒绝；兼容性依赖本机密钥、凭据、容器变体和系统，请保留原文件并复核结果。NCM AV3A 仅支持 Windows。本次不提交 Microsoft Store 安装包。

发布流程要求完整测试、依赖审计和真实引擎检查通过后，才公开 Windows 10/11 x64 标准安装包、独立 Windows 7 SP1 x64 兼容安装包、macOS arm64/x64 DMG。全部必需任务成功才发布；标签绑定实际构建提交，附件 `SHA256SUMS.txt` 提供下载文件校验值。上游测试数量、上游安装包摘要不作为 Mahiro 新包的验证证据。

Windows 包未签名；macOS 包未签名、未公证。真实 Win7 与 Mac 设备仍待验收，自动构建与启动检查不能代替真机安装、升级、卸载验收。Win7 使用已停止维护的 Electron 22，排除现代 Windows 文档引擎。

原作者：**牢蜂（LaoFeng）**；Mahiro Format 升级与维护：**YKZStudio**。

非官方绪山真寻同人主题，与原作权利方不存在官方授权、合作或从属关系。仅供个人免费使用，禁止商业售卖/转卖/套壳。第三方组件保留各自许可证。
