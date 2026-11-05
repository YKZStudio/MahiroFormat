import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flyingmouse_docstructure.__main__ import main
from flyingmouse_docstructure.normalize import ResourceLimitError
from flyingmouse_docstructure.pipeline import (_resolve_models, REQUIRED_MODELS,
    MissingModelError, preflight_pdf, _ascii_staging_root)


class PreflightTests(unittest.TestCase):
    def test_missing_model_payload_is_rejected_even_when_directories_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in REQUIRED_MODELS:
                (root / name).mkdir()
            with self.assertRaises(MissingModelError):
                _resolve_models(root)
            for name in REQUIRED_MODELS:
                for filename in ("inference.json", "inference.pdiparams", "inference.yml"):
                    (root / name / filename).write_bytes(b"test payload")
            self.assertEqual(set(_resolve_models(root)), set(REQUIRED_MODELS))
            (root / REQUIRED_MODELS[0] / "inference.pdiparams").write_bytes(b"")
            with self.assertRaises(MissingModelError):
                _resolve_models(root)

    def test_page_and_raster_limits_fail_before_paddle_construction(self):
        import fitz
        for pages, width, height in [(501, 100, 100), (50, 595, 842), (1, 9000, 10)]:
            with self.subTest(pages=pages, width=width), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); source = root / "source.pdf"
                with fitz.open() as document:
                    for _ in range(pages): document.new_page(width=width, height=height)
                    document.save(str(source))
                with self.assertRaises(ResourceLimitError): preflight_pdf(source)
                stderr = io.StringIO()
                with mock.patch("flyingmouse_docstructure.__main__.build_pipeline") as build, redirect_stderr(stderr):
                    code = main(["parse", "--input", str(source), "--output", str(root / "out"),
                        "--models", str(root / "missing"), "--language", "ch"])
                self.assertEqual(code, 23)
                self.assertEqual(json.loads(stderr.getvalue())["code"], "RESOURCE_LIMIT")
                build.assert_not_called()

    def test_unicode_user_temp_uses_existing_ascii_short_alias(self):
        with tempfile.TemporaryDirectory(prefix="中文临时") as tmp:
            with mock.patch.dict("os.environ", {"TEMP": tmp, "TMP": tmp, "LOCALAPPDATA": tmp}), \
                 mock.patch("flyingmouse_docstructure.pipeline._windows_short_path", return_value=Path("C:/Users/ASCII~1/Temp")):
                self.assertEqual(_ascii_staging_root(), Path("C:/Users/ASCII~1/Temp"))

    def test_utf8_native_process_keeps_unicode_models_without_copy(self):
        from flyingmouse_docstructure.pipeline import _stage_ascii_models
        models = {"sample": Path("C:/Users/中文/扫描模型")}
        with mock.patch("flyingmouse_docstructure.pipeline._native_paths_are_utf8", return_value=True), \
             mock.patch("flyingmouse_docstructure.pipeline._ascii_staging_root") as stage:
            self.assertEqual(_stage_ascii_models(models), (models, None))
        stage.assert_not_called()


if __name__ == "__main__": unittest.main()
