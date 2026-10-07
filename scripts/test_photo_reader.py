import json, tempfile, unittest
from datetime import date
from pathlib import Path

import photo_reader


def reading(days=20, unclear=0, **extra):
    people = lambda d: [{"name": f"Perez{d}", "hours": "08-20", "unclear": d <= unclear}, {"name": "Gomez", "hours": None, "unclear": False}]
    return {"is_schedule": True, "service": "UCO", "month": 10, "year": 2026, "legibility": 90,
            "days": [{"day": d, "people": people(d)} for d in range(1, days + 1)], "observations": None, **extra}


class PhotoReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        photo_reader.AI_DIR = Path(self.tmp.name) / "ai"
        self.image = Path(self.tmp.name) / "a.jpg"
        self.image.write_bytes(b"\xff\xd8\xff demo")
        self.calls = 0
        self._config = photo_reader.config
        photo_reader.config = lambda: {"enabled": True, "key": "k", "model": "m", "budget": 10.0, "calls": 2, "in": 1.0, "out": 1.0}

    def tearDown(self):
        photo_reader.config = self._config
        self.tmp.cleanup()

    def fake(self, cfg, image):
        self.calls += 1
        return reading(), 1000, 500

    def test_same_image_is_paid_once_and_cap_is_respected(self):
        first = photo_reader.transcribe(self.image, "h1", self.fake)
        again = photo_reader.transcribe(self.image, "h1", self.fake)
        self.assertEqual((self.calls, first["reading"], again["reading"]), (1, reading(), reading()))
        photo_reader.transcribe(self.image, "h2", self.fake)
        self.assertIn("tope mensual", photo_reader.transcribe(self.image, "h3", self.fake)["reason"])
        self.assertEqual(self.calls, 2)

    def test_disabled_never_calls(self):
        photo_reader.config = lambda: {"enabled": False}
        self.assertIn("no habilitada", photo_reader.transcribe(self.image, "h9", self.fake)["reason"])
        self.assertEqual(self.calls, 0)

    def test_shifts_and_rejections(self):
        ok = photo_reader.to_shifts(reading(), date(2026, 10, 2), None, None)
        self.assertEqual((ok["year"], ok["month"], len(ok["shifts"])), (2026, 10, 20))
        self.assertEqual(ok["shifts"][0], {"date": "2026-10-01", "text": "Perez1 08-20 · Gomez"})
        self.assertIn("no es una planilla", photo_reader.to_shifts(reading(is_schedule=False), date(2026, 10, 2), None, None)["reason"])
        self.assertIn("poco legible", photo_reader.to_shifts(reading(legibility=40), date(2026, 10, 2), None, None)["reason"])
        self.assertIn("pocos días", photo_reader.to_shifts(reading(days=5), date(2026, 10, 2), None, None)["reason"])
        self.assertEqual(ok["people"]["2026-10-01"], [["Perez1", "08-20", False], ["Gomez", "", False]])
        self.assertIn("no coincide", photo_reader.to_shifts(reading(month=3), date(2026, 10, 2), None, None)["reason"])
        some = photo_reader.to_shifts(reading(unclear=2), date(2026, 10, 2), None, None)
        self.assertIn("(dudoso)", some["shifts"][0]["text"])

    def test_month_from_mail_when_not_written(self):
        late = photo_reader.to_shifts(reading(month=None, year=None), date(2026, 9, 29), None, None)
        self.assertEqual((late["year"], late["month"]), (2026, 10))
        early = photo_reader.to_shifts(reading(month=None, year=None), date(2026, 10, 2), None, None)
        self.assertEqual((early["year"], early["month"]), (2026, 10))



class CorrectNameTest(unittest.TestCase):
    def test_uses_known_spelling_and_never_guesses(self):
        import ingest_pending as ip
        known = {"COCUZZA": "Cocuzza", "PARRA": "Parra", "GIMENEZ": "Gimenez", "JIMENEZ": "Jimenez", "SIN": "Sin", "CENTENO": "Centeno", "RUIZ": "Ruiz", "RUIS": "Ruis"}
        self.assertEqual(ip.correct_name("Zin", known, 0.8), ("Sin", True))               # una letra distinta en un apellido corto
        self.assertEqual(ip.correct_name("CENTE", known, 0.8), ("CENTENO", True))         # apellido cortado en la foto
        self.assertEqual(ip.correct_name("Dr. Cente", known, 0.8), ("Dr. Centeno", True))
        self.assertEqual(ip.correct_name("Ruix", known, 0.8), ("Ruix", False))            # dos candidatos (Ruiz, Ruis): no se elige
        self.assertEqual(ip.correct_name("Couzza", known, 0.72), ("Cocuzza", True))
        self.assertEqual(ip.correct_name("PABRA", known, 0.72), ("PARRA", True))
        self.assertEqual(ip.correct_name("Parra", known, 0.88), ("Parra", True))
        self.assertEqual(ip.correct_name("Yasuff", known, 0.72), ("Yasuff", False))      # nadie parecido: queda como se leyó
        self.assertEqual(ip.correct_name("Himenez", known, 0.72), ("Himenez", False))    # dos candidatos parejos: no se elige
        self.assertEqual(ip.correct_name("Parro", known, 0.8), ("Parra", True))


if __name__ == "__main__":
    unittest.main()
