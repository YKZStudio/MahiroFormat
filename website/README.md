# Mahiro Format website

[English](README.md) | [简体中文](README_zh_CN.md)

A responsive static project website. Serve this directory with any static HTTPS host; there are no runtime dependencies or build steps. Assets use relative URLs, so hosting under a repository subdirectory also works.

The page reads the public GitHub latest-release API. `release-data.json` is a verified fallback snapshot for networks unable to access GitHub. Update it from the current release metadata when refreshing the website. Only matching published assets from YKZStudio/MahiroFormat become active download links. Latest builds link to the release Actions workflow.

Palette: cream #FFF9F6, blush #FCE5EB, rose #B74670, purple #66538B, text #342E3D, green #E2EEDC. Icons: Phosphor Icons 2.1.1, MIT license in `assets/icons/LICENSE.txt`.

Original author: 牢蜂 (LaoFeng). Mahiro Format upgrades and maintenance: YKZStudio. Unofficial Mahiro Oyama fan theme, without official endorsement or affiliation. Personal, free, non-commercial use only. See `LICENSE.txt` and `assets/ASSET-NOTICE.md`.
