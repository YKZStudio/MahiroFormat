# 发布指南

<p align="center">
  <a href="RELEASE.md">English</a> |
  <a href="RELEASE_zh_CN.md">简体中文</a>
</p>

本文只描述当前发布流程。具体版本的哈希、测试数量和外部状态应写入发行说明或交接文档，不应长期固化在流程指南中。

## 打标签前

1. 同步 `package.json`、`package-lock.json`、`win7-package-lock.json`、发行说明和产物名中的版本。
2. 确认 `build/icon.png` 来自 `public/assets/mahiro-format/mahiro-avatar.png`；用 `scripts/gen-appx-logos.js` 重新生成并核对四个商店 logo。
3. 确认 `public/assets/mahiro-format/ASSET-NOTICE.md` 随包保留，公开材料继续声明非官方同人主题。
4. 恢复固定引擎资产、校验 SHA-256，并探测目标平台所需的每个引擎。
5. 运行完整测试、生产依赖审计、经授权的真实样本回归和 `git diff --check`。
6. 检查解包应用的 ASAR 白名单、引擎、产品版本、Mahiro 图标、声明和启动冒烟。
7. 任一必需测试、审计、架构、包结构、PE、引擎或冒烟门禁失败时停止发布。

常用检查：

```powershell
npm ci
npm test
npm audit --omit=dev
git diff --check
```

## Windows 10/11 x64

```powershell
npm run dist
```

预期 NSIS 产物：`dist/Mahiro Format-Setup-<version>-x64.exe`。

需要核对解包应用、运行时引擎、文件版本、内嵌图标、安装包大小/SHA-256 和安装版转换冒烟。尚未配置签名证书时保留 `signExecutable: false`；不要改为 `signAndEditExecutable: false`，后者还会跳过图标和资源编辑。

## Windows 7 SP1 x64 Legacy（旧版兼容）

```powershell
node scripts/build-win7.js --prepare-only
npm run dist:win7
node scripts/inspect-pe.js "output/win7-stage/dist/win-unpacked/Mahiro Format.exe"
npm audit --omit=dev --prefix output/win7-stage
```

- 仅使用 Node.js 18–22 构建，推荐 Node.js 22 LTS。
- staging（临时构建目录）固定为 `output/win7-stage`，使用 `win7-package-lock.json` 和 `npm ci` 重建。
- profile 固定 Electron 22.3.27、Sharp 0.32.6、PDF.js 2.16.105 和 NSIS x64 产物。
- 禁止为了兼容 Windows 7 改写或降级根 manifest。
- PE 兼容性要检查内层 `win-unpacked/Mahiro Format.exe`，不能检查 NSIS 外壳。
- Release 必须披露未签名、Electron 22 已停止维护、旧依赖审计和真实 Windows 7 验收状态。

## macOS

```powershell
npm run dist:mac:arm64
npm run dist:mac:x64
```

- 在原生 runner 上使用匹配架构的固定引擎包构建。
- 核对 Mach-O 架构、bundle 内容、转换探测、DMG 挂载/卸载和启动冒烟。
- 不得用 Rosetta 掩盖错误架构依赖。
- 当前包未签名且未公证；Gatekeeper 行为和真机验收必须单独披露。
- 未打包时，不得在 macOS 宣传 Windows 专属的 AV3A 或结构化文档引擎。

## Microsoft Store

商店渠道使用相同源码单独构建 Windows 10/11 x64 APPX/MSIX，禁止提交 NSIS 或 Windows 7 Legacy 包。

- 核对 Identity、Publisher、版本、架构、模块清单、Mahiro logo、隐私/支持链接和同人主题声明。
- 商店构建必须隐藏并拒绝实验性特殊音乐容器入口。
- 包验证、Certification（认证）和公开 Publishing（发布）是不同状态；只能记录在 Partner Center 现场回读并带绝对日期的状态。
- 历史提交和包哈希只属于商店归档记录，不能作为新包证据。

## GitHub 发布

1. 推送已审查提交并等待分支 CI。
2. 创建新的不可变 `v<version>` 标签；禁止移动历史标签。
3. 等待标签触发的 Release 校验工作流。
4. 创建或更新 Draft（草稿）Release，只上传通过验证的产物。
5. 所有必需任务通过后才公开并设为 Latest。
6. 回读标签指向、资产名、字节数、digest（摘要）和 URL。
7. 将精确证据写入发行说明或交接文档。

当前仓库是 `YKZStudio/MahiroFormat`。`LaoFeng-mouse/flyingmouse-format` 只表示原始上游仓库或历史发行，引用时必须明确标注。
