import unittest
from pathlib import Path
from unittest import mock

import ingest_pending as ip


class ReadDocTests(unittest.TestCase):
    def read(self, text):
        with mock.patch.object(ip, "_doc_text", return_value=text), mock.patch.object(Path, "read_bytes", return_value=b""):
            return ip.read_doc(Path("x.doc"))

    def test_rows_close_with_header_width(self):
        titles, tables = self.read("OCTUBRE\rLUNES\x07MARTES\x07\x071\rUno\x07\x07\x07\r")
        self.assertEqual(titles, ["OCTUBRE"])
        self.assertEqual(tables, [[["LUNES", "MARTES"], ["1\nUno", ""]]])

    def test_misaligned_table_is_not_published(self):
        _, tables = self.read("LUNES\x07MARTES\x07\x071\x072\x073\x07\x07\r")
        self.assertEqual(tables, [])

    def test_backlog_is_not_processed(self):
        self.assertEqual(ip.BACKLOG_BEFORE.isoformat(), "2026-09-21")


if __name__ == "__main__":
    unittest.main()
