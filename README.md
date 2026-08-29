# Mahiro Format

<p align="center">
  <a href="README.md">English</a> |
  <a href="README_zh_CN.md">简体中文</a>
</p>

> An offline desktop file converter with an unofficial Mahiro Oyama fan theme.

Mahiro Format converts documents, images, PDFs, audio, video, e-books, and archives locally on your computer. It provides a desktop interface, batch processing, previews, a command-line interface (CLI), and an Agent skill.

The character artwork is AI-generated, unofficial fan art. It does not use official animation frames or promotional artwork. Mahiro Oyama and *ONIMAI: I'm Now Your Sister!* belong to their respective authors and rights holders. This project is not official, endorsed, or affiliated with them. See the [artwork notice](public/assets/mahiro-format/ASSET-NOTICE.md).

Original author: **LaoFeng (牢蜂)**<br>
Mahiro Format upgrade and maintenance: **YKZStudio**

[![CI](https://github.com/YKZStudio/MahiroFormat/actions/workflows/ci.yml/badge.svg)](https://github.com/YKZStudio/MahiroFormat/actions/workflows/ci.yml)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-0078D6)
![License](https://img.shields.io/badge/License-Non--Commercial-e95f6d)

![Mahiro Format fan-theme interface](public/assets/screenshots/home.png)

## Highlights

- Local processing with bundled FFmpeg, LibreOffice, Poppler, Tesseract, Sharp, and platform-specific helper engines.
- Images, text, Office/WPS documents, PDFs, audio, video, e-books, and ZIP archives.
- Batch conversion with per-file progress, results, error details, individual saving, and Save All.
- Result previews for images, PDFs, text, audio, and video.
- Target-format preferences stored separately for each source extension, plus the last save directory and interface language.
- Chinese and English interface; the first launch follows the system language.
- CLI and an installable Agent skill for Codex, Claude, and compatible Agent directories.
- PDF to DOCX layout restoration and PDF to XLSX table extraction, including OCR paths for scanned documents.
- PDF splitting, AES-256 encryption, password-based decryption, image-to-PDF ordering, and PDF merging.
- H.264, H.265, and AV1 selection for supported video outputs.
- Resource safeguards: 50 MP and 16,384 px per image, a 100 MP image-to-PDF decode budget, and a 2 GB batch limit. PDF and OCR page counts are not artificially capped.

### Experimental special music containers

NCM, KGG, QQ Music QMC variants, KGMA, KWM, and VPR support is experimental. Compatibility depends on the client version, container variant, locally available keys, account permissions, credentials, and real-file coverage. Keep the original files and verify every result.

- Audio Vivid / AV3A NCM tracks require Windows.
- KGG requires the matching key in the local Kugou `KGMusicV3.db` database.
- Some QQ Music `musicex` variants require valid web login credentials to request a key.
- VPR currently covers at most about 64 MiB of audio data and has the least real-file validation.
- Microsoft Store builds hide and reject these experimental entries.

Only process files that you obtained lawfully and have permission to use. This project is not affiliated with any music platform. See [Special music format compatibility (Chinese)](docs/特殊音乐格式兼容说明.md) for the detailed boundaries.

## Supported formats

| Category | Input | Output |
|---|---|---|
| Images | jpg, png, webp, avif, tiff, gif, bmp, heic, heif, tga, ico, camera RAW formats | png, jpg, webp, avif, tiff, gif, ico, pdf, txt (OCR), mp4, webm |
| Text | txt, md, html, json, csv, tsv, log, xml, yaml | txt, md, html, json, csv, pdf, docx, epub |
| E-books | epub, mobi | txt, md, epub |
| Word/WPS/OFD | doc, docx, odt, rtf, wps, wpt, wpd, ofd | PDF and compatible document/text targets; OFD is limited to PDF conversion |
| Excel/WPS | xls, xlsx, xlsm, ods, csv, tsv, et, ett | pdf, xlsx, xls, ods, csv, html |
| PowerPoint/WPS | ppt, pptx, odp, dps, dpt | pdf, pptx, odp, html, png, jpg |
| PDF | pdf | docx, xlsx, txt, html, png, jpg, split/encrypted/decrypted PDF |
| Audio | common audio formats plus experimental NCM/KGG/QMC/KGMA/KWM/VPR containers | mp3, wav, flac, m4a, ogg, aac, opus, wma |
| Video | mp4, mov, mkv, webm, avi, m4v, wmv, flv | mp4, webm, mkv, mov, gif, and common audio formats |
| Archives | zip or arbitrary files | image ZIP to PDF; any file to ZIP |

The available targets are computed from the selected files and installed engines. Use the UI or `targets` CLI command as the authoritative list for a specific file.

## Installation

### Prebuilt packages

Check the [current repository's Releases page](https://github.com/YKZStudio/MahiroFormat/releases) first. Historical upstream packages and releases remain available in the [original repository](https://github.com/LaoFeng-mouse/flyingmouse-format/releases).

Choose the package that matches your system:

- **Windows 10/11 x64:** standard installer, built with Electron 43.
- **Windows 7 SP1 x64:** `win7-x64` Legacy installer, built with Electron 22.3.27. It no longer receives upstream Electron security updates; use it offline with trusted files only.
- **Apple Silicon:** `mac-arm64.dmg`.
- **Intel Mac:** `mac-x64.dmg`.

Windows installers are currently unsigned and may trigger SmartScreen. macOS packages are unsigned and unnotarized and may trigger Gatekeeper. Physical Windows 7 and Mac acceptance must be tracked separately from automated build checks.

### Run from source

Requirements:

- Node.js 18 or newer. Node.js 22 LTS is recommended for building the Windows 7 staging package.
- The external engines under `bin/` for the complete conversion feature set. Large FFmpeg, LibreOffice, Poppler, Tesseract, and document-engine resources are not stored in Git.

```powershell
npm ci
npm run desktop
```

Run tests and build the standard Windows package:

```powershell
npm test
npm run dist
```

Build the isolated Windows 7 package:

```powershell
node scripts/build-win7.js --prepare-only
npm run dist:win7
```

## Command-line interface

```powershell
node cli.js capabilities --json
node cli.js targets example.pdf --json
node cli.js convert input.docx --to pdf --output output.pdf --json
node cli.js convert a.png b.png --to webp --output-dir converted --json
node cli.js images-to-pdf 1.jpg 2.jpg --output album.pdf --json
node cli.js merge-pdfs a.pdf b.pdf --output merged.pdf --json
```

Packaged applications accept the same commands after `--cli`:

- Windows: `Mahiro Format.exe --cli ...`
- macOS: `Mahiro Format.app/Contents/MacOS/Mahiro Format --cli ...`

The **Connect to Agent** action installs or updates the bundled skill only in existing Codex, Claude, or generic Agent skill directories after confirmation.

## Privacy and security

- Files are processed locally and are not uploaded to a cloud conversion service.
- The Electron renderer uses context isolation, sandboxing, restricted navigation, a random loopback-only port, and a per-launch session token.
- Source files are not modified. Temporary inputs and outputs are cleaned from the local runtime directory.
- Debug logs remain local and may contain filenames, engine paths, and error details, but not file contents.
- Credentials, keys, certificates, private samples, and generated engine bundles must never be committed.

Read the [privacy policy](docs/privacy-policy.html) and [architecture documentation](docs/ARCHITECTURE.md) for details.

## Documentation

The [documentation index](docs/README.md) separates current references, release procedures, user guides, historical release notes, and archived design records.

## License

Mahiro Format uses a [non-commercial license](LICENSE). Personal, non-commercial use and redistribution are allowed when the license and attribution are retained. Commercial sale, resale, paid-service use, rebranding, reskinning, and repackaging as another product are prohibited.

Bundled third-party components keep their own licenses. The bundled document engine includes PyMuPDF under AGPL-3.0; its source is available from the [PyMuPDF repository](https://github.com/pymupdf/PyMuPDF).

## Credits and upstream

- Original author: **LaoFeng (牢蜂)**
- Mahiro Format upgrade and maintenance: **YKZStudio**
- [Current repository](https://github.com/YKZStudio/MahiroFormat)
- [Original repository and historical issues](https://github.com/LaoFeng-mouse/flyingmouse-format)

Mahiro Format is free, offline, and ad-free. Optional support information is shown in the Chinese README.
