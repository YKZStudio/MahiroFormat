# Mahiro Format

<p align="center">
  <a href="README.md">English</a> |
  <a href="README_zh_CN.md">简体中文</a>
</p>

> 一款采用非官方绪山真寻同人主题、可离线使用的桌面文件格式转换工具。

Mahiro Format 可在本机转换文档、图片、PDF、音视频、电子书和压缩包，并提供桌面界面、批量处理、结果预览、命令行界面（CLI）和 Agent skill。

界面角色图是 AI 生成的非官方同人素材，不含动画截图或官方宣传图。绪山真寻及《别当欧尼酱了！》的相关权利归原作者及相应权利方所有；本项目与原作权利方不存在官方合作、授权或从属关系。详见[主题素材声明](public/assets/mahiro-format/ASSET-NOTICE.md)。

原作者：**牢蜂（LaoFeng）**<br>
Mahiro Format 升级与维护：**YKZStudio**

[![CI](https://github.com/YKZStudio/MahiroFormat/actions/workflows/ci.yml/badge.svg)](https://github.com/YKZStudio/MahiroFormat/actions/workflows/ci.yml)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-0078D6)
![License](https://img.shields.io/badge/License-Non--Commercial-e95f6d)

![Mahiro Format 同人主题界面](public/assets/screenshots/home.png)

## 主要功能

- 本地处理：使用内置的 FFmpeg、LibreOffice、Poppler、Tesseract、Sharp 和平台专用辅助引擎。
- 支持图片、文本、Office/WPS 文档、PDF、音频、视频、电子书和 ZIP 压缩包。
- 批量转换：显示逐文件进度、结果和错误，可单独保存或全部保存。
- 结果预览：支持图片、PDF、文本、音频和视频。
- 分别记住每种源扩展名的目标格式，同时记住最近保存目录和界面语言。
- 中文和 English 界面：首次启动跟随系统语言，手动选择后会保存设置。
- 提供 CLI，并可将配套 Agent skill 接入 Codex、Claude 或兼容的 Agent 目录。
- PDF → DOCX 版式还原与 PDF → XLSX 表格提取；扫描文档可使用 OCR 路径。
- 支持 PDF 拆分、AES-256 加密、密码解密、图片排序合并 PDF 和 PDF 合并。
- 支持为兼容的视频输出选择 H.264、H.265 或 AV1 编码。
- 资源保护：单图不超过 50MP / 16384px，图片合并 PDF 总解码量不超过 100MP，批量总大小不超过 2GB；PDF 和 OCR 不人为限制页数。

### 特殊音乐容器（实验性）

NCM、KGG、QQ 音乐 QMC 变体、KGMA、KWM 和 VPR 均属于不稳定的实验性兼容功能。实际结果受客户端版本、容器变体、本机密钥、账号权限、凭据和真实样本覆盖影响。请保留源文件，并逐一复核输出。

- Audio Vivid / AV3A NCM 音轨仅支持 Windows。
- KGG 需要本机酷狗 `KGMusicV3.db` 中与歌曲匹配的密钥。
- 部分 QQ 音乐 `musicex` 变体需要有效的网页登录凭据来请求密钥。
- VPR 当前最多覆盖约 64 MiB 音频数据，真实样本验证最少。
- Microsoft Store 构建会隐藏并拒绝这些实验性入口。

只能处理你合法取得且有权使用的文件。本项目与任何音乐平台均无关联。详细边界见[特殊音乐格式兼容说明](docs/特殊音乐格式兼容说明.md)。

## 支持格式

| 类别 | 输入 | 输出 |
|---|---|---|
| 图片 | jpg、png、webp、avif、tiff、gif、bmp、heic、heif、tga、ico、相机 RAW 等 | png、jpg、webp、avif、tiff、gif、ico、pdf、txt（OCR）、mp4、webm |
| 文本 | txt、md、html、json、csv、tsv、log、xml、yaml | txt、md、html、json、csv、pdf、docx、epub |
| 电子书 | epub、mobi | txt、md、epub |
| Word/WPS/OFD | doc、docx、odt、rtf、wps、wpt、wpd、ofd | PDF 及兼容的文档/文本目标；OFD 仅支持转换为 PDF |
| Excel/WPS | xls、xlsx、xlsm、ods、csv、tsv、et、ett | pdf、xlsx、xls、ods、csv、html |
| PowerPoint/WPS | ppt、pptx、odp、dps、dpt | pdf、pptx、odp、html、png、jpg |
| PDF | pdf | docx、xlsx、txt、html、png、jpg、拆分/加密/解密 PDF |
| 音频 | 常见音频格式，以及实验性的 NCM/KGG/QMC/KGMA/KWM/VPR 容器 | mp3、wav、flac、m4a、ogg、aac、opus、wma |
| 视频 | mp4、mov、mkv、webm、avi、m4v、wmv、flv | mp4、webm、mkv、mov、gif 和常见音频格式 |
| 压缩包 | ZIP 或任意文件 | 图片 ZIP 合并为 PDF；任意文件打包为 ZIP |

软件会根据所选文件和本机可用引擎动态计算目标格式。判断某个文件时，请以界面或 CLI 的 `targets` 命令为准。

## 安装

### 安装包

请先查看[当前仓库的 Releases 页面](https://github.com/YKZStudio/MahiroFormat/releases)。原项目的历史安装包和发行记录仍保留在[上游仓库](https://github.com/LaoFeng-mouse/flyingmouse-format/releases)。

按系统选择安装包：

- **Windows 10/11 x64**：标准安装包，使用 Electron 43。
- **Windows 7 SP1 x64**：文件名含 `win7-x64` 的 Legacy（旧版兼容）安装包，使用 Electron 22.3.27。该版本已无法获得 Electron 上游安全更新，只建议离线处理可信文件。
- **Apple Silicon**：`mac-arm64.dmg`。
- **Intel Mac**：`mac-x64.dmg`。

Windows 安装包目前未签名，SmartScreen 可能提示；macOS 包未签名且未公证，Gatekeeper 可能拦截。Windows 7 和 Mac 真机验收必须与自动化构建检查分开记录。

### 从源码运行

要求：

- Node.js 18 或更新版本。构建 Windows 7 staging（临时构建目录）时推荐 Node.js 22 LTS。
- 如需完整转换能力，应自行准备 `bin/` 下的外部引擎。体积较大的 FFmpeg、LibreOffice、Poppler、Tesseract 和文档引擎资源不存入 Git。

```powershell
npm ci
npm run desktop
```

运行测试并构建标准 Windows 包：

```powershell
npm test
npm run dist
```

构建隔离的 Windows 7 兼容包：

```powershell
node scripts/build-win7.js --prepare-only
npm run dist:win7
```

## 命令行界面（CLI）

```powershell
node cli.js capabilities --json
node cli.js targets example.pdf --json
node cli.js convert input.docx --to pdf --output output.pdf --json
node cli.js convert a.png b.png --to webp --output-dir converted --json
node cli.js images-to-pdf 1.jpg 2.jpg --output album.pdf --json
node cli.js merge-pdfs a.pdf b.pdf --output merged.pdf --json
```

安装版也可在 `--cli` 后使用相同命令：

- Windows：`Mahiro Format.exe --cli ...`
- macOS：`Mahiro Format.app/Contents/MacOS/Mahiro Format --cli ...`

软件中的“接入 Agent”会在确认后，仅向已有的 Codex、Claude 或通用 Agent skill 目录安装或更新配套 skill。

## 隐私与安全

- 文件在本机处理，不上传到云端转换服务。
- Electron 渲染进程使用上下文隔离、沙箱、导航限制、随机本机回环端口和每次启动生成的会话令牌。
- 源文件不会被修改；临时输入和输出会从本机运行目录清理。
- 调试日志只保存在本机，可能包含文件名、引擎路径和错误详情，但不包含文件正文。
- 凭据、密钥、证书、私人样本和生成的引擎包不得提交到仓库。

更多信息见[隐私政策](docs/privacy-policy-zh-CN.html)和[架构说明](docs/ARCHITECTURE_zh_CN.md)。

## 文档

[文档索引](docs/README_zh_CN.md)已将当前参考文档、发布流程、用户教程、历史发行说明和归档设计记录分开整理。

## 许可证

Mahiro Format 使用[非商用许可证](LICENSE)。保留许可证和作者署名时，允许个人非商用使用和传播；禁止商业售卖、转卖、收费服务、套壳、换皮或改名后重新打包为其他产品。

内置第三方组件继续遵循各自许可证。内置文档引擎包含采用 AGPL-3.0 的 PyMuPDF，其源码见 [PyMuPDF 官方仓库](https://github.com/pymupdf/PyMuPDF)。

## 署名与上游

- 原作者：**牢蜂（LaoFeng）**
- Mahiro Format 升级与维护：**YKZStudio**
- [当前仓库](https://github.com/YKZStudio/MahiroFormat)
- [原项目与历史问题记录](https://github.com/LaoFeng-mouse/flyingmouse-format)

Mahiro Format 免费、离线且无广告。如果它帮到了你，欢迎请真寻吃份布丁，完全自愿。

![微信收款码](public/assets/sponsor-qr.jpg)
