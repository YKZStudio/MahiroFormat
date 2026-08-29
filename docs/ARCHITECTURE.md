# Architecture

<p align="center">
  <a href="ARCHITECTURE.md">English</a> |
  <a href="ARCHITECTURE_zh_CN.md">简体中文</a>
</p>

## Runtime overview

```text
Electron main process
├─ creates a restricted BrowserWindow
├─ starts an Express service on a random 127.0.0.1 port
├─ exposes narrow save/settings IPC through preload
└─ resolves packaged or development conversion engines
        ↓
Mahiro UI (public/) → local API (server.js) → converters/engines → temporary output
        ↓
Electron save dialog → user-selected destination
```

## Main modules

| Module | Responsibility |
|---|---|
| `electron-main.js` | Electron lifecycle, local service, runtime paths, trusted IPC, and saving |
| `electron-security.js` | Navigation, external-link, download, and IPC-origin policy |
| `preload.js` | Minimal renderer bridge |
| `server.js` | Uploads, detection, target calculation, conversion dispatch, and downloads |
| `config.js` / `utils.js` | Format registry, engine discovery, categories, and target calculation |
| `resource-policy.js` | Shared image, PDF, OCR, and batch resource budgets |
| `text-conversion.js` | Markdown/HTML conversion and strict CSV parsing |
| `pdf.js` | PDF routing, DOCX conversion, split, encryption, and decryption |
| `pdf-table-*.js` | Digital/OCR table extraction and workbook modeling |
| `pdf-structure-*.js` | Scanned-document classification, manifest validation, scoring, and engine boundary |
| `office-engine.js` | Isolated LibreOffice profiles, probes, execution, and stable errors |
| `settings-store.js` | Atomic versioned settings in Electron `userData/settings.json` |
| `public/app.js` | Queue, conversion, preview, save, and mascot-state interaction |
| `public/i18n.js` | `zh-CN` / `en-US` translation state and migration support |

## Local API and trust boundary

- `GET /api/session` returns a per-launch 256-bit session token and is never cached.
- `GET /api/capabilities` returns available engines, formats, and resource limits.
- `POST /api/targets` computes targets common to all selected files.
- `POST /api/convert` converts one file.
- `POST /api/convert-images-to-pdf` merges ordered images into a PDF.
- `POST /api/merge-pdfs` merges PDF files.
- `GET /downloads/:id` serves temporary results from the current session.

Every POST request validates the session token. Browser requests must also match the exact loopback origin for the current random port. Download paths are reduced to controlled identifiers and safe basenames.

Electron keeps `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Navigation is restricted to the current loopback origin; external opening is limited to credential-free HTTPS URLs.

## Settings

The main process owns a versioned settings document containing:

- `language`: `zh-CN` or `en-US`;
- `targetBySource`: normalized source extension to target extension;
- `lastSaveDirectory`: updated only after a successful save.

Legacy `localStorage` values are migrated once on a best-effort basis. Missing, invalid, or corrupted settings fall back to defaults and never block conversion.

## Conversion engines

| Capability | Primary implementation |
|---|---|
| Audio and video | FFmpeg |
| Audio Vivid / AV3A | Windows AVS3 decoder + FFmpeg |
| Office/WPS | LibreOffice with an isolated application-owned profile |
| OFD to PDF | `@miconvert/ofd-to-pdf` (local JavaScript) |
| PDF rendering | Poppler |
| OCR | Tesseract |
| Images | Sharp; FFmpeg/dcraw for selected formats |
| PDF layout to DOCX | bundled `docengine` (`pdf2docx`) with fallback |
| Scanned PDF structure | bundled `docstructure` manifest engine |
| PDF encryption/splitting | qpdf with a limited `pdf-lib` fallback |

Large binary engines are excluded from Git and packaged through `extraResources`. Environment overrides are available for development and tests; release workflows restore pinned assets and verify hashes before use.

OFD is registered as a document input but exposes only PDF as a conversion target. It is intercepted before LibreOffice because LibreOffice does not support OFD.

## PDF behavior

Digital PDFs use PDF.js coordinates, `docengine`, and table extraction fast paths. Scanned or mixed PDFs may route through OCR and the structure-manifest engine. DOCX/XLSX output is validated before publication; low-confidence or structurally unusable results fail with stable error codes instead of returning nominal files.

PDF-to-XLSX table extraction remains heuristic. Complex headers, irregular merged cells, poor scans, rotation, shadows, and handwriting may require review. Raw or reference sheets preserve evidence when a useful structured result exists.

## Resource and quality policy

- 50 MP and 16,384 px maximum per image.
- 100 MP total decoded pixels for image-to-PDF operations.
- 2 GB total selected batch size.
- No artificial PDF/OCR page cap; long documents can take substantial time and memory.
- Markdown conversion uses shared ATX headings and fenced-code behavior.
- CSV parsing uses the pinned `csv-parse` implementation and fails closed on malformed row widths.
- Errors retain a stable `errorCode` and localized messages.

## Platform profiles

- Standard Windows 10/11 x64: root manifest, Electron 43.
- Windows 7 SP1 x64: derived staging manifest under `output/win7-stage`, Electron 22.3.27, Sharp 0.32.6, and PDF.js 2.16.105. It never downgrades the root manifest.
- macOS arm64/x64: architecture-specific engine bundles; AV3A and Windows-only document engines are excluded when unavailable.

The Windows 7 builder validates Node.js 18–22, manifest/lockfile immutability, canonical resource containment, reparse-point boundaries, packaged PE metadata, and exact artifact naming.

## Product boundary

Mahiro Format uses an unofficial Mahiro Oyama fan theme. Artwork affects presentation only and does not change the conversion, privacy, or security boundary. The artwork notice must remain packaged. The former mouse artwork and the separate “鼠鼠打印” project are not part of the current product.
