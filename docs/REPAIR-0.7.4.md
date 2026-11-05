# 0.7.4 Windows 启动兼容修复

2026-09-16，作者：牢蜂（LaoFeng）。基于公共主线 `fb17ed666002eb938f65b8c834a1e05dc9ec0338`，针对用户反馈的双击打不开及引擎启动失败。公开源码和微软商店包继续仅支持普通音频格式；特殊音乐模块仅保留在独立本地版。

## 原因与修改

用户诊断显示 Electron 在应用 JavaScript 执行之前，因无法打开 Windows NUL 设备而直接退出。在独立测试进程中禁止打开 NUL 后，旧版出现相同的 `Unable to open nul device needed for initialization`。仅给 Electron 加参数后，忽略子进程 stdin 的调用仍会通过 libuv 打开 NUL，继续影响 FFmpeg、LibreOffice 及 Store 引擎验证。

- 增加原生兼容入口，启动 Electron 时传递 `--no-stdio-init`，使用真实日志文件和空输入文件兜底标准句柄，转发参数、工作目录及退出码。用户入口清除继承的开发环境开关；内部 Node worker 保留原运行路径。
- 通用转换进程与 Office 进程改用 pipe 并立即关闭输入；Store 同步验证也使用空输入，避免再次打开 NUL。
- 隐藏窗口收到第二次启动时先显示，再聚焦。非 Store 任务栏和 Agent CLI 指回兼容入口；Store 保留包身份。
- 诊断报告记录是否经过兼容启动。原鼠鼠 UI、Electron 安全配置、引擎和作者许可保持不变。
- 打包 CLI 验证发现首位 `--help` / `-h` 被当作转换命令；现在这些帮助入口正常输出帮助并返回 0。
- 构建在 `afterSign` 阶段附加入口；原 Electron EXE 与本次 ASAR 始终配套。商店封包默认生成 MSIX，校验两个 EXE、ASAR、身份和公开功能边界。

## 验证状态

完整源码回归：前置 104 通过，主测试 690 通过、13 跳过、0 失败；随后新增 7 项真实 ASAR 边界测试及 1 项 CLI 帮助回归均通过。生产依赖审计 0 个已知漏洞。商店包校验器 20 个 Python 测试通过，包括缺失 Runtime、EXE 被替换和绕过兼容入口的拒绝测试；Win7 构建隔离相关 31 项测试通过。

真实公开打包程序完成 UI 启动、普通 FLAC→MP3（完整 PCM 解码）、DOCX→PDF（提取正文）、加密特殊格式拒绝、诊断 IPC 导出及隐藏窗口第二实例恢复。独立进程 NUL 故障注入下 UI 就绪、普通音频转换及完整解码通过。公开 ASAR 门禁通过；同版号的本地音乐包被门禁拒绝。CLI 帮助修复后整体重建最终应用，最终 MSIX 摘要与运行复核结果以本轮交付记录为准。

源码版本和本地 MSIX 构建均不代表已在微软商店上架；未执行 Partner Center 提交、认证或公开发布。本轮不生成或发布公开 NSIS、Win7 和 macOS 安装包。Win7 使用原独立启动路径，macOS 跳过 Windows 原生入口。

首轮 GitHub CI 的 Windows 与 macOS arm64 通过；Intel macOS 唯一失败项是旧临时目录测试使用固定 PID 1111，无法保证它在 runner 上已退出。测试夹具现改为真实启动并正常退出的两个子进程 PID，原活动进程及目录边界保护均保留。相关 7 项测试通过；该后续提交只修改测试和记录，商店包运行代码不变，远程结果需按修复后的提交复核。

## 构建

安装 MSVC x64 工具和 Windows SDK。脚本优先使用 `FLYINGMOUSE_VCVARS_PATH` 或已有 VS 环境，否则通过 `vswhere` 查找。执行 `npm run dist:appx` 默认整体构建后产出 unsigned MSIX；仅在独立验证过本次完整构建时使用 `-SkipBuild -WinUnpackedPath`。外部 builder 配置必须显式继承 `package.json.build`，包括白名单与 `afterSign`，不能依赖自动合并。

未签名 MSIX 用于商店提交准备，普通用户安装需要受信签名或商店分发。本次开发验证不改变已有 Store 注册或用户设置。
