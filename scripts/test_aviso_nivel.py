import io, json, os, tempfile, unittest
from pathlib import Path

import aviso_nivel


class Smtp:
    sent = []
    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def login(self, user, password): pass
    def send_message(self, message): Smtp.sent.append(message)


NOTICE = {"de": "verde", "a": "naranja", "motivos": [{"origen": "Radar", "texto": "Tormenta fuerte con posible granizo sobre San Rafael"}]}


class AvisoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        (Path(self.tmp.name) / "server").mkdir()
        aviso_nivel.APP_ROOT = Path(self.tmp.name)
        os.environ["HOSPITAL_IMAP_ACCOUNT"], os.environ["HOSPITAL_IMAP_PASSWORD"] = "casilla@example.org", "x"
        Smtp.sent = []

    def tearDown(self):
        self.tmp.cleanup()

    def config(self, value):
        (aviso_nivel.APP_ROOT / "server" / "avisos-config.json").write_text(json.dumps({"correo": value}), "utf-8")

    def test_off_or_without_recipients_sends_nothing(self):
        for value in ({"activo": False, "para": ["a@example.org"]}, {"activo": True, "para": []}):
            self.config(value)
            aviso_nivel.main(io.StringIO(json.dumps(NOTICE)), Smtp)
        self.assertEqual(Smtp.sent, [])

    def test_on_sends_one_message_with_level_and_reason(self):
        self.config({"activo": True, "para": ["a@example.org", "b@example.org"]})
        aviso_nivel.main(io.StringIO(json.dumps(NOTICE)), Smtp)
        self.assertEqual(len(Smtp.sent), 1)
        self.assertEqual(Smtp.sent[0]["To"], "a@example.org, b@example.org")
        self.assertIn("NARANJA", Smtp.sent[0]["Subject"])
        self.assertIn("Radar: Tormenta fuerte", Smtp.sent[0].get_content())


if __name__ == "__main__":
    unittest.main()
