import json, os, tempfile, unittest
from datetime import date, datetime
from pathlib import Path

import reclamos


class FakeSmtp:
    sent = []
    def __init__(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def login(self, user, password): pass
    def send_message(self, message): FakeSmtp.sent.append(message)


def fixture(root: Path, docs):
    (root / "catalog").mkdir(parents=True); (root / "mail").mkdir()
    (root / "catalog" / "live.json").write_text(json.dumps({"documents": docs, "unread": [{"id": "u1", "departments": ["demo"]}]}), "utf-8")
    pending = [{"id": "d1", "from": "Uno <uno@example.org>", "date": "Tue, 01 Sep 2026 09:00:00 -0300"},
               {"id": "u1", "from": "Dos <dos@example.org>", "date": "Wed, 02 Sep 2026 09:00:00 -0300"},
               {"id": "d0", "from": "Tres <tres@example.org>", "date": "Mon, 03 Aug 2026 09:00:00 -0300"},
               {"id": "x1", "from": "Otro <otro@example.org>", "date": "Tue, 01 Sep 2026 09:00:00 -0300"}]
    (root / "mail" / "pending.json").write_text(json.dumps(pending), "utf-8")


SEPT = [{"id": "d1", "departments": ["demo"], "year": 2026, "month": 9, "shifts": [{"date": "2026-09-01", "text": "A"}]},
        {"id": "d0", "departments": ["demo"], "year": 2026, "month": 8, "shifts": [{"date": "2026-08-01", "text": "A"}]},
        {"id": "x1", "departments": ["otro"], "year": 2026, "month": 10, "shifts": [{"date": "2026-10-01", "text": "B"}]}]


class ReclamosTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        fixture(root, SEPT)
        self.config = root / "config.json"
        reclamos.DATA_DIR, reclamos.MAIL_DIR, reclamos.STATE_FILE, reclamos.CONFIG_FILE = root, root / "mail", root / "mail" / "reclamos.json", self.config
        reclamos.CONTROL_FILE = root / "mail" / "reclamos-control.json"
        reclamos.ACCOUNT, reclamos.PASSWORD = "casilla@example.org", "x"
        FakeSmtp.sent = []

    def tearDown(self):
        self.tmp.cleanup()

    def enable(self, **extra):
        self.config.write_text(json.dumps({"enabled": True, **extra}), "utf-8")

    def state(self):
        return json.loads(reclamos.STATE_FILE.read_text("utf-8"))

    def test_target_month(self):
        self.assertEqual(reclamos.target_month(date(2026, 10, 27), 3, 2), (2026, 10, 2))
        self.assertEqual(reclamos.target_month(date(2026, 10, 28), 3, 2), (2026, 10, 2))
        self.assertEqual(reclamos.target_month(date(2026, 10, 29), 3, 2), (2026, 11, 1))
        self.assertEqual(reclamos.target_month(date(2026, 12, 31), 3, 2), (2027, 1, 1))
        self.assertEqual(reclamos.target_month(date(2026, 11, 1), 3, 2), (2026, 11, 2))

    def test_disabled_sends_nothing_but_writes_plan(self):
        result = reclamos.run(datetime(2026, 10, 6, 17), FakeSmtp)
        self.assertEqual((result["sent"], result["due"]), (0, 1))
        self.assertEqual(FakeSmtp.sent, [])
        self.assertEqual(self.state()["services"]["demo"]["to"], ["dos@example.org", "uno@example.org"])
        self.assertEqual(self.state()["services"]["otro"]["status"], "recibida")

    def test_twice_a_day_after_first_and_stops_when_loaded(self):
        self.enable()
        self.assertEqual(reclamos.run(datetime(2026, 10, 6, 7), FakeSmtp)["sent"], 0)
        self.assertEqual(reclamos.run(datetime(2026, 10, 6, 8, 5), FakeSmtp)["sent"], 1)
        self.assertEqual(reclamos.run(datetime(2026, 10, 6, 8, 15), FakeSmtp)["sent"], 0)
        self.assertEqual(reclamos.run(datetime(2026, 10, 6, 16, 5), FakeSmtp)["sent"], 1)
        self.assertEqual(reclamos.run(datetime(2026, 10, 6, 19), FakeSmtp)["sent"], 0)
        self.assertEqual(FakeSmtp.sent[0]["To"], "dos@example.org, uno@example.org")
        self.assertIn("octubre 2026", FakeSmtp.sent[0]["Subject"])
        fixture_docs = SEPT + [{"id": "n1", "departments": ["demo"], "year": 2026, "month": 10, "shifts": [{"date": "2026-10-07", "text": "A"}]}]
        (reclamos.DATA_DIR / "catalog" / "live.json").write_text(json.dumps({"documents": fixture_docs}), "utf-8")
        self.assertEqual(reclamos.run(datetime(2026, 10, 7, 9), FakeSmtp)["sent"], 0)
        self.assertEqual(self.state()["services"]["demo"]["status"], "recibida")

    def test_once_a_day_before_month_and_never_at_night(self):
        self.enable()
        self.assertEqual(reclamos.run(datetime(2026, 10, 29, 9), FakeSmtp)["sent"], 2)  # noviembre: faltan los dos servicios
        self.assertEqual(reclamos.run(datetime(2026, 10, 29, 17), FakeSmtp)["sent"], 0)
        self.assertEqual(reclamos.run(datetime(2026, 10, 30, 21), FakeSmtp)["sent"], 0)
        self.assertIn("noviembre 2026", FakeSmtp.sent[0]["Subject"])

    def test_excluded_and_no_catalog(self):
        self.enable(exclude=["demo"])
        self.assertEqual(reclamos.run(datetime(2026, 10, 6, 9), FakeSmtp)["sent"], 0)
        (reclamos.DATA_DIR / "catalog" / "live.json").write_text("{}", "utf-8")
        self.assertEqual(reclamos.run(datetime(2026, 10, 6, 9), FakeSmtp)["status"], "sin_catalogo")

    def test_cancelled_for_this_month_only(self):
        self.enable()
        reclamos.CONTROL_FILE.write_text(json.dumps({"paused": {"demo": "2026-10"}}), "utf-8")
        self.assertEqual(reclamos.run(datetime(2026, 10, 6, 9), FakeSmtp)["sent"], 0)
        self.assertEqual(self.state()["services"]["demo"]["status"], "cancelado")
        self.assertEqual(reclamos.run(datetime(2026, 11, 2, 9), FakeSmtp)["sent"], 2)

    def test_smtp_failure_stops_after_three(self):
        self.enable()
        class Broken(FakeSmtp):
            def login(self, user, password): raise OSError("sin red")
        for _ in range(5):
            reclamos.run(datetime(2026, 10, 6, 9), Broken)
        self.assertEqual(self.state()["failures"]["2026-10-06|demo"], 3)


if __name__ == "__main__":
    unittest.main()
