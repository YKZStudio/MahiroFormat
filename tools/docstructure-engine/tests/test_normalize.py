import json
import sys
import tempfile
import unittest
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_ROOT))

from flyingmouse_docstructure.normalize import Limits, ResourceLimitError, normalize_page


class NormalizePageTests(unittest.TestCase):
    def test_sparse_cells_keep_html_positions_and_spatial_ocr_confidence(self):
        boxes = [[column * 100, row * 100, (column + 1) * 100, (row + 1) * 100]
                 for row in range(4) for column in range(4)]
        texts = ["A-001", "2026-08", "0.00", "Confirmed"]
        html = "<table>" + "".join("<tr>" + "".join(
            "<td>" + (texts[column] if row == 1 else "") + "</td>"
            for column in range(4)) + "</tr>" for row in range(4)) + "</table>"
        raw = {"width": 400, "height": 400, "table_res_list": [{
            "cell_box_list": boxes, "pred_html": html,
            "table_ocr_pred": {"rec_texts": texts, "rec_scores": [.99] * 4,
                "rec_boxes": [[column * 100 + 10, 120, column * 100 + 90, 170]
                              for column in range(4)]}}]}
        with tempfile.TemporaryDirectory() as tmp:
            table = normalize_page(1, raw, Path(tmp))["tableCandidates"][0]
        self.assertEqual([cell["text"] for cell in table["cells"]], [""] * 4 + texts + [""] * 8)
        self.assertEqual([cell["confidence"] for cell in table["cells"]], [0.] * 4 + [.99] * 4 + [0.] * 8)

    def test_multiple_ocr_runs_require_matching_text_and_use_lowest_confidence(self):
        from flyingmouse_docstructure.normalize import _matched_cell_confidence
        self.assertEqual(_matched_cell_confidence("multi line", [0, 0, 100, 100],
            ["multi", "line"], [.97, .65], [[10, 10, 40, 30], [10, 40, 40, 60]]), .65)
        self.assertEqual(_matched_cell_confidence("invented", [0, 0, 100, 100],
            ["other"], [.99], [[10, 10, 40, 30]]), 0.)

    def test_normalizes_official_ppstructure_table_result_shape(self):
        raw = {"width": 400, "height": 600, "parsing_res_list": [
            {"block_label": "table", "block_bbox": [10, 20, 390, 180],
             "block_content": "must not become editable table text"}], "table_res_list": [{
            "cell_box_list": [[10, 20, 200, 100], [200, 20, 390, 100],
                              [10, 100, 390, 180]],
            "pred_html": "<table><tr><td>A</td><td>B</td></tr>"
                         "<tr><td colspan='2'>C</td></tr></table>",
            "table_ocr_pred": {"rec_texts": ["A", "B", "C"],
                               "rec_scores": [.95, .96, .94]}
        }]}
        with tempfile.TemporaryDirectory() as tmp:
            page = normalize_page(1, raw, Path(tmp))
        self.assertEqual(page["tables"], [])
        self.assertEqual(page["tableCandidates"][0]["source"], "pp-structure-v3")
        self.assertEqual(page["blocks"][0]["tableId"], page["tableCandidates"][0]["id"])
        self.assertNotIn("text", page["blocks"][0])
        table = page["tableCandidates"][0]
        self.assertEqual((table["rowCount"], table["columnCount"]), (2, 2))
        self.assertEqual(table["cells"][2]["columnSpan"], 2)
        self.assertEqual(table["cells"][1]["text"], "B")
        self.assertAlmostEqual(table["confidence"], .95)

    def test_normalizes_anonymous_paddle_page_to_schema_v1(self):
        raw = {
            "width": 1200,
            "height": 1800,
            "rotation": 0,
            "parsing_res_list": [
                {"block_label": "doc_title", "block_bbox": [80, 90, 1120, 180],
                 "block_content": "Anonymous title", "block_score": 0.98},
                {"block_label": "seal", "block_bbox": [900, 1300, 1080, 1480],
                 "block_score": 0.93, "block_content": "guessed seal text",
                 "asset": "seal-001.png"},
            ],
            "table_res_list": [{
                "bbox": [100, 400, 1100, 900], "confidence": 0.96,
                "cells": [
                    {"row": 0, "column": 0, "row_span": 1, "col_span": 1,
                     "bbox": [100, 400, 600, 650], "text": "A", "confidence": 0.97},
                    {"row": 0, "column": 1, "row_span": 1, "col_span": 1,
                     "bbox": [600, 400, 1100, 650], "text": "B", "confidence": 0.96},
                    {"row": 1, "column": 0, "row_span": 1, "col_span": 2,
                     "bbox": [100, 650, 1100, 900], "text": "C", "confidence": 0.95},
                ],
            }],
        }
        with tempfile.TemporaryDirectory() as tmp:
            page = normalize_page(1, raw, Path(tmp))
        self.assertEqual(page["pageNumber"], 1)
        self.assertEqual(page["referenceImage"], "page-001.png")
        self.assertTrue(page["tableLike"])
        self.assertEqual(page["blocks"][0]["type"], "heading")
        self.assertEqual(page["blocks"][1]["asset"], "seal-001.png")
        table = page["tableCandidates"][0]
        self.assertEqual((table["rowCount"], table["columnCount"]), (2, 2))
        self.assertEqual(table["cells"][2]["columnSpan"], 2)
        self.assertEqual(table["confidence"], 0.96)
        self.assertNotIn("text", page["blocks"][1])

    def test_candidates_use_task7_schema_and_deterministic_order(self):
        raw = {"width": 400, "height": 600, "tableLike": True,
               "tableCandidates": [
                   {"source": "img2table", "id": "z", "rowCount": 1, "columnCount": 1,
                    "bbox": [0, 0, 10, 10], "confidence": .8,
                    "cells": [{"row": 0, "column": 0, "rowSpan": 1, "columnSpan": 1,
                               "bbox": [0, 0, 10, 10], "text": "x", "confidence": .8}]},
                   {"source": "pp-structure-v3", "id": "a", "rowCount": 1, "columnCount": 1,
                    "bbox": [0, 0, 10, 10], "confidence": .9,
                    "cells": [{"row": 0, "column": 0, "rowSpan": 1, "columnSpan": 1,
                               "bbox": [0, 0, 10, 10], "text": "x", "confidence": .9}]},
               ]}
        with tempfile.TemporaryDirectory() as tmp:
            page = normalize_page(2, raw, Path(tmp))
        self.assertEqual([c["source"] for c in page["tableCandidates"]],
                         ["pp-structure-v3", "img2table"])
        self.assertEqual(page["tableCandidates"][0]["cells"][0]["rowSpan"], 1)

    def test_rejects_text_and_count_limits_before_large_output(self):
        raw = {"width": 100, "height": 100, "parsing_res_list": [
            {"block_label": "text", "block_bbox": [0, 0, 10, 10],
             "block_content": "abcdef", "block_score": .9}]}
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ResourceLimitError):
                normalize_page(1, raw, Path(tmp), Limits(max_text_length=5))


if __name__ == "__main__":
    unittest.main()
