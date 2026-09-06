# Mahiro Format v0.6.5

[English](release-notes-065.md) | [简体中文](release-notes-065_zh_CN.md)

This release brings the current YKZStudio/MahiroFormat main branch to a packaged release, including the Mahiro fan theme, bilingual interface and recent performance improvements.

- Streamed image-to-PDF output reduces peak memory use.
- Shared engine capability probes and fewer batch UI redraws reduce repeated work.
- Local conversion for documents, images, PDFs, audio/video, ebooks and ZIP files; batch processing and result previews.
- Mahiro theme assets and application icons preserve the current project identity.
- Release metadata is tied to the exact tested commit. All platform builds, conversion tests and dependency audits must pass before publication; SHA256SUMS.txt is included for asset verification.

Choose the Windows 10/11 x64 installer, the separate Windows 7 SP1 x64 compatibility installer, or the macOS arm64/x64 DMG for your computer. Windows installers are unsigned; macOS packages are unsigned and not notarized. Automated packaging checks do not constitute real Windows 7 or Mac hardware acceptance; those remain pending. Windows 7 does not include the standard Windows document engine.

Experimental music-container compatibility remains subject to local keys, credentials, container variants and platform restrictions. Keep source files and verify results. Microsoft Store builds exclude these features. This release does not publish any Microsoft Store package.

Original author: **牢蜂 (LaoFeng)**. Mahiro Format upgrades and maintenance: **YKZStudio**.

Non-official 绪山真寻 (Mahiro Oyama) fan theme; no official authorization, endorsement or affiliation with the original rights holders. Personal, free, non-commercial use only. Commercial sales, resale and repackaging/reskinning are prohibited. Third-party components retain their own licenses.
