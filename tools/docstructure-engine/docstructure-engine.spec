# -*- mode: python ; coding: utf-8 -*-
import re
from pathlib import Path

import setuptools  # activates the _vendor sys.path insert so vendored top-level modules resolve
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules, copy_metadata

root = Path(SPECPATH)

datas = (
    collect_data_files("paddlex")
    + collect_data_files("paddleocr")
    + collect_data_files("img2table")
)

binaries = collect_dynamic_libs("paddle")

# PaddleX validates its extras through importlib.metadata. Only the locked
# runtime distributions belong in the application, not unrelated build-host
# packages (including credentials-bearing tooling and GPU frameworks).
for _name in re.findall(r"^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?==", (root / "requirements-win-x64.lock").read_text("utf-8"), re.M):
    datas += copy_metadata(_name)

hiddenimports = ["paddleocr", "paddlex", "img2table", "fitz", "PIL"]

# setuptools vendors packages under setuptools/_vendor and exposes them top-level
# via a sys.path insert. PyInstaller's static analysis misses conditional imports
# inside them (e.g. jaraco.context -> backports on Python < 3.12), so collect the
# vendored submodules under their top-level names.
_vendor = Path(setuptools.__file__).parent / "_vendor"
for _pkg in _vendor.iterdir():
    if not _pkg.is_dir():
        continue
    try:
        hiddenimports += collect_submodules(_pkg.name)
    except Exception:
        pass

a = Analysis(
    [str(root / "flyingmouse_docstructure" / "__main__.py")],
    pathex=[str(root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[], hooksconfig={}, runtime_hooks=[],
    excludes=["tkinter", "torch", "torchvision", "torchaudio", "tensorflow",
              "jax", "jaxlib", "cupy", "nvidia", "triton", "pytest", "IPython",
              "transformers", "sentence_transformers", "diffusers", "accelerate",
              "librosa", "numba", "llvmlite", "onnxruntime"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="docstructure-engine",
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=True, disable_windowed_traceback=True,
          manifest=str(root / "windows-utf8.manifest"))
dist = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False,
               name="docstructure-engine")
