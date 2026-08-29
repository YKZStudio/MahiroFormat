# Release guide

<p align="center">
  <a href="RELEASE.md">English</a> |
  <a href="RELEASE_zh_CN.md">简体中文</a>
</p>

This document describes the current release process. Version-specific evidence belongs in release notes or the handoff, not in this guide.

## Before tagging

1. Synchronize the version in `package.json`, `package-lock.json`, `win7-package-lock.json`, the release notes, and artifact names.
2. Confirm `build/icon.png` is derived from `public/assets/mahiro-format/mahiro-avatar.png`. Regenerate APPX logos with `scripts/gen-appx-logos.js` and verify all four Store assets.
3. Keep `public/assets/mahiro-format/ASSET-NOTICE.md` in the package and retain the unofficial fan-theme notice in public materials.
4. Restore pinned engine assets, verify SHA-256 values, and probe every engine required by the target platform.
5. Run the full tests, production dependency audit, real-file regressions authorized for local use, and `git diff --check`.
6. Inspect the unpacked application: ASAR whitelist, engines, product version, Mahiro icon, notices, and launch smoke.
7. Stop the release if any required test, audit, architecture, package, PE, engine, or smoke gate fails.

Typical checks:

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

Expected NSIS output: `dist/Mahiro Format-Setup-<version>-x64.exe`.

Verify the unpacked application, runtime engines, file version, embedded icon, installer size/SHA-256, and a packaged-app conversion smoke test. `signExecutable: false` is intentional while no signing certificate is configured; do not replace it with `signAndEditExecutable: false`, which also skips icon/resource editing.

## Windows 7 SP1 x64 Legacy

```powershell
node scripts/build-win7.js --prepare-only
npm run dist:win7
node scripts/inspect-pe.js "output/win7-stage/dist/win-unpacked/Mahiro Format.exe"
npm audit --omit=dev --prefix output/win7-stage
```

- Build only with Node.js 18–22; Node.js 22 LTS is recommended.
- The staging tree is rebuilt under `output/win7-stage` with `win7-package-lock.json` and `npm ci`.
- The profile pins Electron 22.3.27, Sharp 0.32.6, PDF.js 2.16.105, and NSIS x64 output.
- Do not edit or downgrade the root manifest to obtain Windows 7 compatibility.
- Inspect the inner `win-unpacked/Mahiro Format.exe`, not the NSIS bootstrapper, for PE compatibility.
- Disclose the unsigned installer, Electron 22 end-of-life status, legacy dependency audit, and physical Windows 7 acceptance state.

## macOS

```powershell
npm run dist:mac:arm64
npm run dist:mac:x64
```

- Build each architecture on a native runner with its matching pinned engine bundle.
- Verify Mach-O architectures, bundle contents, conversion probes, DMG mount/unmount, and launch smoke.
- Do not use Rosetta to conceal a wrong-architecture dependency.
- Packages are currently unsigned and unnotarized; disclose Gatekeeper behavior and physical-device acceptance separately.
- Do not advertise Windows-only AV3A or structured-document engines on macOS when they are not packaged.

## Microsoft Store

The Store channel uses a separately built Windows 10/11 x64 APPX/MSIX from the same source. Never submit the NSIS installer or the Windows 7 Legacy package.

- Verify Identity, Publisher, version, architecture, module list, Mahiro logos, privacy/support links, and the fan-theme notice.
- Store builds must hide and reject experimental special-music container routes.
- Package validation, Certification, and public Publishing are separate states. Record only states read directly from Partner Center, with an absolute date.
- Historical submissions and package hashes are archived in the Store-specific records; they are not evidence for a new package.

## GitHub publication

1. Push the reviewed commit and wait for branch CI.
2. Create a new immutable `v<version>` tag; never move a historical tag.
3. Wait for the tag-triggered release validation workflow.
4. Create or update a Draft release and upload only validated artifacts.
5. Publish and mark Latest only after all required jobs pass.
6. Read back the tag target, asset names, byte sizes, digests, and URLs.
7. Record the exact evidence in the release notes or handoff.

The current repository is `YKZStudio/MahiroFormat`. References to `LaoFeng-mouse/flyingmouse-format` identify the original upstream repository or historical releases and must be labeled as such.
