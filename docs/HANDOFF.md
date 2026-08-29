# Project handoff

<p align="center">
  <a href="HANDOFF.md">English</a> |
  <a href="HANDOFF_zh_CN.md">简体中文</a>
</p>

Updated: 2026-08-29

## Current baseline

- Repository: `YKZStudio/MahiroFormat`
- Reviewed base commit: `71f3ade` (`fix(ci): audit the lockfile across platforms`)
- Package version: `0.6.4`
- Main runtime: Electron 43, Windows 10/11 x64
- Compatibility profiles: Windows 7 SP1 x64 via isolated Electron 22 staging; macOS arm64/x64 via architecture-specific engine bundles
- Product identity: unofficial Mahiro Oyama fan theme; original author LaoFeng, upgrade and maintenance by YKZStudio
- License: repository non-commercial license; bundled third-party components retain their own licenses

## Active capabilities and boundaries

- The source currently registers experimental NCM, KGG, QMC, KGMA, KWM, and VPR routes. Microsoft Store builds hide and reject them.
- OFD exposes PDF only and is handled by the local `@miconvert/ofd-to-pdf` path, not LibreOffice.
- PDF to DOCX uses `docengine` when available and falls back when it is not.
- Scanned/mixed PDF Office conversion uses classification and the structured-document engine when packaged; results are validated before publication.
- Large engines under `bin/` are not generally tracked. A source checkout without them cannot run the complete conversion or packaging acceptance suite.
- Windows installers are unsigned; macOS packages are unsigned and unnotarized; Windows 7 and Mac physical-device acceptance must not be inferred from CI.

## Documentation state

- `README.md` is English and `README_zh_CN.md` is Simplified Chinese, with language links at the top.
- Core architecture, release, handoff, and privacy documents follow the same English-default / `_zh_CN` or `-zh-CN` pairing.
- `docs/README.md` and `docs/README_zh_CN.md` are the authoritative documentation indexes.
- Versioned release notes, Store validation records, and `docs/superpowers/` plans/specifications are historical evidence. Do not rewrite them as current product state.
- The original upstream repository is `LaoFeng-mouse/flyingmouse-format`; current development links should use `YKZStudio/MahiroFormat` unless explicitly describing upstream history.

## Verification expectations

For documentation-only changes, run at least:

```powershell
git diff --check
node scripts/check-docs.js
```

For runtime or release changes, also follow [the release guide](RELEASE.md), run the full test/audit gates, restore the pinned engines, inspect packaged outputs, and record exact evidence.

## Open operational items

- Publish current-repository releases only after the current commit and artifacts pass the documented gates.
- Reconfirm Microsoft Store status in Partner Center before updating any external-state claim.
- Record physical Windows 7 and macOS acceptance only after testing on those systems.
- Keep credentials, certificates, private source files, user documents, and unredacted diagnostics out of Git.
