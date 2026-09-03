# Performance review and regression checks

[English](PERFORMANCE.md) | [简体中文](PERFORMANCE_zh_CN.md)

## Scope and decisions

This review covers the desktop/main-process boundary, renderer, CLI, conversion modules,
Python document-engine wrapper, and build/release scripts. The baseline is commit
`70e24bfe964ec819dcc4a10512f5b5b5d83a527f` (2026-09-03 review).
External engine binaries and model weights are not source-code review or runtime-validation evidence.

Changes are deliberately concentrated in three measured/reproducible paths:

- `image.js`: decode/compress one PDF page at a time; count byte offsets instead of
  repeatedly concatenating the entire PDF prefix; write chunks with backpressure.
  Compression uses asynchronous zlib. Blank-page image data is reused only within a job.
  A short, exclusive sibling temporary filename avoids extending long output basenames;
  publication happens only after all pages have been written and the handle closed.
  Failed decoding, writing, or publication cleans up the temporary file and preserves an existing output.
- `server.js`: independent engine probes start together, while concurrent callers share
  the same pending promise. Expected Office failures retain their diagnostic details;
  unexpected failures permit a later retry. Removed 81 unused imported bindings and
  an obsolete Tesseract cache left behind by module extraction.
- `public/app.js`: one target request per normalized extension per selection, without
  persisting failed requests. Late detection results cannot replace a newer/cleared
  selection. Conversion updates replace only the affected row; merged jobs initialize
  their rows in one render. Queue state is initialized after download reset so image
  reordering remains valid. DOM creation and `textContent` remain the rendering boundary.

No dependencies, package versions, conversion parameters, OCR/table quality thresholds,
resource budgets, licensing/branding, security settings, or Windows 7 build profiles changed.
In particular, this does not parallelize memory-heavy conversion jobs.

## Reproduce the PDF comparison

```sh
node scripts/benchmark-image-pdf.js --baseline 70e24bfe964ec819dcc4a10512f5b5b5d83a527f --samples 3
```

The script uses a deterministic 512×512 RGB noise image, runs each measurement in a
fresh process, alternates revision order, and verifies identical SHA-256 outputs.
Its fixtures and generated PDFs are removed afterward. Use only a trusted baseline:
the script executes that revision's `image.js` with the currently installed dependencies.

Snapshot: Linux x64, Node.js 24.19.0, three samples per case, medians shown below.
The full JavaScript suite was not running during this measurement.

| Pages | Time before → after (ms) | Peak RSS before → after (MiB) | Cumulative Buffer.concat bytes before → after (MiB) |
|---|---:|---:|---:|
| 8 | 756 → 405 | 123 → 75 | 93 → 6 |
| 24 | 3948 → 1101 | 203 → 95 | 712 → 18 |
| 48 | 12800 → 1998 | 322 → 94 | 2720 → 36 |

All three PDF sizes were byte-identical before/after. The 48-page output was
37,782,976 bytes. These synthetic results are not a promise for other formats,
image content, hardware, or Windows/macOS installations. Peak RSS is the worker's
process high-water mark; concatenation volume is cumulative copying, not live memory.

## Verification

- `npm run test:ci`: prerequisite suite 94/94 passed. Main suite: baseline
  472 passed / 22 failed / 15 skipped; updated 489 passed / 22 failed / 15 skipped.
  The same 22 test names failed; there were no new failures.
- The 17 added tests cover pixel/page/index correctness, asynchronous/lazy image
  processing, failure cleanup and existing-output preservation, concurrent probes,
  probe retry, target-query deduplication, stale selections, and bounded row creation.
- Existing failures are in conversion integration tests requiring unavailable bundled
  FFmpeg/LibreOffice/OCR resources or Windows-specific executable paths on this host.
  The suite is **not fully green**; restore the pinned platform engines before release.
- Python wrapper: `python -m unittest discover -s tests -v` from
  `tools/docstructure-engine`: 34 passed. This does not run real Paddle inference.
- JavaScript syntax, documentation links, and `git diff --check` were checked separately.
- Windows/macOS installers, Electron GUI interaction, and real Windows 7 compatibility
  were not verified on this Linux host. Existing CI and native-machine checks remain required.

## Deferred high-risk work

- Consolidating repeated DOCX ZIP reads requires preserving WPS numbering, CRC repair,
  and embedded-asset behavior across real documents.
- Python parsing retains a growing manifest and repeatedly scans output-budget state.
  Changing this requires rebuilding the locked engine and validating representative scans.
- The Python wrapper still declares a 500-page limit, unlike the general PDF/OCR
  unlimited-page wording. This pre-existing inconsistency was not resolved by weakening
  resource safeguards during the performance change.
- Selecting/clearing a queue during an active conversion needs a separate cancellation
  and job-ownership design; stale *detection* protection is not conversion cancellation.
