import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class DataSafetyTests(unittest.TestCase):
    def test_hospital_location_is_san_rafael(self):
        catalog = json.loads((ROOT / "src" / "data" / "catalog.json").read_text(encoding="utf-8"))
        self.assertEqual(catalog["location"], "San Rafael, Mendoza")

    def test_staff_has_no_placeholder_people(self):
        staff = json.loads((ROOT / "src" / "data" / "staff.json").read_text(encoding="utf-8"))
        surnames = {str(person.get("surname", "")).strip().upper() for people in staff["services"].values() for person in people}
        self.assertNotIn("SIN", surnames)

    def test_public_staff_file_has_no_address_field(self):
        records = json.loads((ROOT / "src" / "data" / "legajos.json").read_text(encoding="utf-8"))
        for record in records.values():
            self.assertNotIn("consultorio", record)
            if record.get("phone"):
                self.assertTrue(str(record["phone"]).isdigit())

    def test_runtime_scripts_have_no_workspace_dependency(self):
        for name in ("imap_sync.py", "gmail_imap_probe.py", "ingest.py", "ingest_mail.py", "lab-fetch.py"):
            self.assertNotIn("/workspace", (ROOT / "scripts" / name).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
