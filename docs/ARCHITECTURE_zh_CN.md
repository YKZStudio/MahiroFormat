# 架构说明

<p align="center">
  <a href="ARCHITECTURE.md">English</a> |
  <a href="ARCHITECTURE_zh_CN.md">简体中文</a>
</p>

## 运行结构

```text
Electron 主进程
├─ 创建受限 BrowserWindow
├─ 在随机 127.0.0.1 端口启动 Express 服务
├─ 通过 preload 暴露最小化保存/设置 IPC
└─ 定位安装包或开发环境中的转换引擎
        ↓
Mahiro UI（public/）→ 本地 API（server.js）→ 转换器/引擎 → 临时结果
        ↓
Electron 保存对话框 → 用户选择的位置
```

## 主要模块

| 模块 | 职责 |
|---|---|
| `electron-main.js` | Electron 生命周期、本地服务、运行时路径、可信 IPC 和保存 |
| `electron-security.js` | 导航、外链、下载和 IPC 来源策略 |
| `preload.js` | 最小化渲染进程桥接 |
| `server.js` | 上传、识别、目标计算、转换调度和下载 |
| `config.js` / `utils.js` | 格式注册、引擎发现、类别和目标计算 |
| `resource-policy.js` | 图片、PDF、OCR 和批量资源预算 |
| `text-conversion.js` | Markdown/HTML 转换和严格 CSV 解析 |
| `pdf.js` | PDF 路由、DOCX、拆分、加密和解密 |
| `pdf-table-*.js` | 电子文字/OCR 表格提取与工作簿模型 |
| `pdf-structure-*.js` | 扫描文档分类、manifest 校验、评分和引擎边界 |
| `office-engine.js` | 隔离的 LibreOffice profile、探测、执行和稳定错误 |
| `settings-store.js` | 在 Electron `userData/settings.json` 中原子保存版本化设置 |
| `public/app.js` | 队列、转换、预览、保存和角色状态交互 |
| `public/i18n.js` | `zh-CN` / `en-US` 翻译状态及旧设置迁移 |

## 本地 API 与信任边界

- `GET /api/session`：返回每次启动生成的 256 位会话令牌，禁止缓存。
- `GET /api/capabilities`：返回可用引擎、格式和资源上限。
- `POST /api/targets`：计算所有所选文件共同支持的目标。
- `POST /api/convert`：转换单个文件。
- `POST /api/convert-images-to-pdf`：按队列顺序合并图片。
- `POST /api/merge-pdfs`：合并 PDF。
- `GET /downloads/:id`：读取当前会话的临时结果。

所有 POST 请求都校验会话令牌；浏览器请求还必须匹配本次随机端口的精确本机回环 origin。下载路径只使用受控标识和安全 basename。

Electron 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。导航只允许当前回环 origin，外部打开仅允许不含凭据的 HTTPS URL。

## 设置

主进程维护版本化设置文档：

- `language`：`zh-CN` 或 `en-US`；
- `targetBySource`：规范化的源扩展名到目标扩展名映射；
- `lastSaveDirectory`：仅在成功保存后更新。

旧版 `localStorage` 数据会尽力迁移一次。设置缺失、非法或损坏时回退默认值，不阻止转换。

## 转换引擎

| 能力 | 主要实现 |
|---|---|
| 音视频 | FFmpeg |
| Audio Vivid / AV3A | Windows AVS3 解码器 + FFmpeg |
| Office/WPS | 使用应用专属隔离 profile 的 LibreOffice |
| OFD → PDF | `@miconvert/ofd-to-pdf`（本地 JavaScript） |
| PDF 渲染 | Poppler |
| OCR | Tesseract |
| 图片 | Sharp；部分格式使用 FFmpeg/dcraw |
| PDF 版式转 DOCX | 内置 `docengine`（`pdf2docx`）及回退路径 |
| 扫描 PDF 结构识别 | 内置 `docstructure` manifest 引擎 |
| PDF 加密/拆分 | qpdf，有限场景回退 `pdf-lib` |

大型二进制引擎不存入 Git，通过 `extraResources` 打包。开发和测试可使用环境变量覆盖路径；发布工作流会恢复固定资产并在使用前校验哈希。

OFD 虽归入文档输入，但只暴露 PDF 目标。LibreOffice 不支持 OFD，因此该分支会在 Office 分发前被拦截。

## PDF 行为

电子 PDF 优先使用 PDF.js 坐标、`docengine` 和表格提取快路径；扫描或混合 PDF 可进入 OCR 与结构 manifest 引擎。DOCX/XLSX 在发布结果前会做结构校验；低置信或不可用结果会返回稳定错误码，而不是生成名义上成功的文件。

PDF → XLSX 仍是启发式能力。复杂表头、不规则合并单元格、低质量扫描、旋转、阴影和手写内容可能需要人工复核；只有存在可用结构化结果时，Raw 或原件对照页才作为补充证据保留。

## 资源与质量策略

- 单图最多 50MP、单边最多 16384px。
- 图片合并 PDF 总解码量最多 100MP。
- 批量选择总大小最多 2GB。
- PDF/OCR 不人为限制页数；长文档可能明显增加耗时和内存占用。
- Markdown 转换共用 ATX 标题和 fenced code（围栏代码块）行为。
- CSV 使用锁定的 `csv-parse`，列数非法时 fail closed（安全失败）。
- 错误保留稳定 `errorCode` 和本地化消息。

## 平台构建

- Windows 10/11 x64 标准版：根 manifest，Electron 43。
- Windows 7 SP1 x64：从 `output/win7-stage` 派生，固定 Electron 22.3.27、Sharp 0.32.6、PDF.js 2.16.105，不改写根 manifest。
- macOS arm64/x64：使用各自架构的引擎包；不可用时排除 AV3A 和 Windows 专用文档引擎。

Windows 7 构建器会校验 Node.js 18–22、manifest/lockfile 不变性、资源 canonical containment（规范路径包含关系）、reparse point（重解析点）边界、内层 EXE 的 PE 元数据和精确产物名。

## 产品边界

Mahiro Format 使用非官方绪山真寻同人主题。素材只影响表现层，不改变转换、隐私或安全边界；素材声明必须随包保留。原版鼠鼠素材和独立项目“鼠鼠打印”不属于当前产品。
