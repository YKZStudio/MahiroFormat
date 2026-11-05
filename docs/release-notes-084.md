# Mahiro Format v0.8.4

[English](release-notes-084.md) | [简体中文](release-notes-084_zh_CN.md)

Synchronizes the original upstream `LaoFeng-mouse/flyingmouse-format` through commit `f7d9eab18e91848f9740261d348717bae3f40c21` (0.8.4), while retaining Mahiro Format's identity, fan artwork, bilingual interface and source layout.

- Fixes Office conversions with long temporary paths and long Unicode filenames. Uses owned short workspaces and preserves user filenames and cleanup boundaries.
- Incorporates PDF, OFD and spreadsheet fidelity fixes, including embedded illustrations, text order, tables, font handling and invalid-input rejection.
- Adds measured conversion phases, elapsed time, cancellation and safer result cleanup. Saves files and Markdown attachments without deleting a user's existing result on failure.
- Improves ICO conversion, ordinary audio/video compatibility, EPUB generation and explicit text-encoding selection.
- Updates locked dependencies and compatibility patches; refreshes the SHA-pinned document structure engine, Markdown engine and CR2 decoder preparation.
- Preserves Mahiro artwork and application icons, author/maintainer attribution, the local session token and sandbox, and the separate Windows 7 build profile. Image admission is limited by available memory and a 50 MP / 16,384 px ceiling; image-PDF batches keep the 100 MP budget and batch inputs keep the 2 GiB limit. PDF/OCR pages are not silently truncated.

Generic file-to-ZIP conversion and folder compression follow the upstream removal; archive-to-PDF workflows remain available. Experimental music-container compatibility is retained in Mahiro and excluded from Microsoft Store operation. Its results depend on local keys, credentials, container variants and platform support; keep original files and verify results. NCM AV3A requires Windows. No Microsoft Store package is submitted by this release.

The release workflow runs complete tests, dependency audits and native engine checks before publishing the standard Windows 10/11 x64 installer, isolated Windows 7 SP1 x64 installer and native macOS arm64/x64 DMGs. Publication depends on every required job succeeding. The release tag targets the exact workflow commit and `SHA256SUMS.txt` records downloaded-asset checksums. Upstream test counts and upstream installer hashes do not describe these Mahiro packages.

Windows installers are unsigned. macOS packages are unsigned and not notarized. Real Windows 7 and Mac device acceptance remains pending; automated builds and smoke checks do not constitute installation/upgrade/uninstall acceptance on physical hardware. The Windows 7 package uses the unsupported Electron 22 runtime and excludes the modern Windows document engines.

Original author: **牢蜂 (LaoFeng)**. Mahiro Format upgrades and maintenance: **YKZStudio**.

Unofficial Mahiro Oyama fan theme; no official authorization, endorsement or affiliation with the original rights holders. Personal, free, non-commercial use only. Commercial sales, resale and rebranding/repackaging are prohibited. Third-party components retain their own licenses.
