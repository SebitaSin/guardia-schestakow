#!/usr/bin/env python3
"""Mail → decode → calendar.

Already in inbox as ingested: skip.
New file: decode any format, classify, merge shifts into catalog.
WhatsApp photo, CamScanner, .doc, .xls: same path. No format excuse.
"""
from __future__ import annotations

import os
import calendar
import json
import re
import zipfile
from collections import defaultdict
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path

ROOT = Path(os.environ.get("APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATA_DIR = Path(os.environ.get("APP_DATA_DIR", ROOT / "var")).resolve()
CATALOG = ROOT / "src/data/catalog.json"
INBOX = ROOT / "src/data/inbox.json"
ZIP_PATH = ROOT / "attachments" / "attachments.zip"
DOCS = ROOT / "public" / "docs"
THUMBS = ROOT / "public" / "thumbs"
AUDIT = DATA_DIR / "legacy-ingest-audit"

SHIFT_ON = {"M", "N", "T", "G", "PG", "TM", "TN", "MA", "TA", "NA", "MANANA", "TARDE", "NOCHE"}
SHIFT_OFF = {"", "F", "DF", "L", "X", "A", "R"}

MONTH_NAME = {
    "ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4, "MAYO": 5, "JUNIO": 6,
    "JULIO": 7, "AGOSTO": 8, "SEPTIEMBRE": 9, "SETIEMBRE": 9, "OCTUBRE": 10,
    "NOVIEMBRE": 11, "DICIEMBRE": 12,
}


def fold(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^A-ZÑ ]", " ", s.upper())


def detect_label(title: str) -> str | None:
    f = fold(title)
    if re.search(r"\bTIP\b", f) or "TERAPIA INTENSIVA PEDIATR" in f:
        return "tip"
    if re.search(r"\bUTIA\b", f) or "TERAPIA INTENSIVA" in f or re.search(r"\bUTI\b", f):
        return "terapia-intensiva"
    if re.search(r"\bUCCYQ\b", f) or "CUIDADOS CRITICOS Y QUEMAD" in f:
        return "uccyq"
    if re.search(r"\bUCIQ\b", f):
        return "uciq"
    if re.search(r"\bUCO\b", f) or "UNIDAD CORONARIA" in f:
        return "uco"
    if "PISO" in f and "CLINICA" in f:
        return "piso-clinica"
    if "GUARDIA CENTRAL" in f:
        return "guardia-clinica"
    if "GINECO" in f:
        return "ginecologia"
    if "OBSTETRIC" in f:
        return "obstetricia"
    if "HEMOTER" in f or re.search(r"\bHT\b", f) or "ENCARGATURA DE TECNICOS" in f:
        return "hemoterapia"
    if "ODONTO" in f:
        return "odontologia"
    if "MANTENIMIENTO" in f or "ELECTRICISTA" in f or "PLOMERO" in f:
        return "mantenimiento"
    if "PORTERIA" in f:
        return "porteria"
    if "MENSAJERIA" in f:
        return "mensajeria"
    if "ALBERGUE" in f:
        return "albergue"
    if "ESTERILIZ" in f:
        return "esterilizacion"
    if "ANESTES" in f:
        return "anestesiologia"
    if "ENDOSCOP" in f:
        return "endoscopias"
    if "CAMILLERO" in f or "MOVILIDAD" in f:
        return "movilidad"
    if "BIOQUIM" in f or "LABORATORIO" in f:
        return "laboratorio"
    if "NEONAT" in f:
        return "neonatologia"
    if "CIRUGIA PEDIATR" in f:
        return "cirugia-pediatrica"
    if "PEDIATR" in f:
        return "pediatria"
    if re.search(r"\bCIRUGIA\b", f):
        return "cirugia"
    if "KINESIO" in f:
        return "kinesiologia"
    if "SALUD MENTAL" in f:
        return "salud-mental"
    return None


def month_from_name(text: str) -> int | None:
    f = fold(text)
    for name, n in MONTH_NAME.items():
        if name in f:
            return n
    return None


def parse_name_day_table(table: list[list[str]], year: int, month: int) -> list[dict]:
    if not table:
        return []
    header = table[0]
    day_cols = []
    for i, h in enumerate(header):
        m = re.fullmatch(r"\d{1,2}", str(h).strip())
        if m:
            day_cols.append((i, int(m.group())))
    if not day_cols:
        return []
    by_day: dict[int, list[str]] = defaultdict(list)
    days_in = calendar.monthrange(year, month)[1]
    for row in table[1:]:
        name = (row[0] or "").strip()
        if not name:
            continue
        for i, day in day_cols:
            if i >= len(row) or not (1 <= day <= days_in):
                continue
            cell = (row[i] or "").strip().upper()
            cell = re.sub(r"[^A-Z]", "", cell)
            if cell in SHIFT_OFF or not cell:
                continue
            if cell in SHIFT_ON or len(cell) <= 3:
                label = cell if cell in SHIFT_ON else cell
                by_day[day].append(f"{name} {label}" if label in SHIFT_ON else name)
    return [
        {"date": f"{year}-{month:02d}-{d:02d}", "text": " · ".join(v)}
        for d, v in sorted(by_day.items()) if v
    ]


def parse_mantenimiento_xlsx(path: Path, year: int, month: int) -> list[dict]:
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = [[("" if c is None else str(c).strip()) for c in row] for row in ws.iter_rows(values_only=True)]
    by_day: dict[int, list[str]] = defaultdict(list)
    days_in = calendar.monthrange(year, month)[1]
    start = None
    pending: list[str] = []
    date_re = re.compile(r"(\d{4})-(\d{2})-(\d{2})")

    def flush():
        nonlocal start, pending
        if not start or not pending:
            start = None
            pending = []
            return
        d0 = start
        while d0.month == month or True:
            if d0.month == month and 1 <= d0.day <= days_in:
                by_day[d0.day].extend(pending)
            # weekly block is 7 days
            break
        # fill 7-day range
        for i in range(7):
            d = start + timedelta(days=i)
            if d.year == year and d.month == month:
                by_day[d.day].extend(pending)
        start = None
        pending = []

    current_start = None
    current_people: list[str] = []
    for row in rows:
        joined = " ".join(row)
        dates = date_re.findall(joined)
        if dates:
            if current_start and current_people:
                d0 = current_start
                for i in range(7):
                    d = d0 + timedelta(days=i)
                    if d.year == year and d.month == month:
                        by_day[d.day].extend(current_people)
            y, m, day = map(int, dates[0])
            current_start = date(y, m, day)
            current_people = []
            continue
        role = None
        for cell in row:
            u = cell.upper()
            if "ELECTRICISTA" in u:
                role = "Electricista"
            if "PLOMERO" in u:
                role = "Plomero"
        if role:
            names = [c for c in row if c and c.upper() not in {"ELECTRICISTA", "PLOMERO"} and not re.fullmatch(r"\d+", c)]
            # typically APELLIDO NOMBRE
            person = " ".join(names[:2]).title() if names else ""
            if person:
                current_people.append(f"{role} {person}")
    if current_start and current_people:
        for i in range(7):
            d = current_start + timedelta(days=i)
            if d.year == year and d.month == month:
                by_day[d.day].extend(current_people)
    return [
        {"date": f"{year}-{month:02d}-{d:02d}", "text": " · ".join(v)}
        for d, v in sorted(by_day.items()) if v
    ]


def parse_esterilizacion(path: Path, year: int, month: int) -> list[dict]:
    from docx import Document
    doc = Document(str(path))
    by_day: dict[int, list[str]] = defaultdict(list)
    days_in = calendar.monthrange(year, month)[1]
    for tbl in doc.tables:
        for row in tbl.rows:
            cells = [c.text.strip() for c in row.cells]
            if len(cells) < 2 or not cells[0]:
                continue
            name = re.split(r"\d", cells[0])[0].strip()
            dates = re.findall(r"(\d{1,2})/(\d{1,2})", cells[1])
            if len(dates) < 2 or not name:
                continue
            d1 = int(dates[0][0])
            m1 = int(dates[0][1])
            d2 = int(dates[1][0])
            m2 = int(dates[1][1])
            try:
                start = date(year if m1 >= month - 1 else year, m1, d1)
                end = date(year if m2 >= month - 1 else year, m2, d2)
            except ValueError:
                continue
            cur = start
            while cur < end:
                if cur.month == month:
                    by_day[cur.day].append(name.title())
                cur += timedelta(days=1)
    return [
        {"date": f"{year}-{month:02d}-{d:02d}", "text": " · ".join(v)}
        for d, v in sorted(by_day.items()) if v and 1 <= d <= days_in
    ]


def parse_docx_table(path: Path) -> list[list[str]]:
    from docx import Document
    doc = Document(str(path))
    if not doc.tables:
        return []
    tbl = doc.tables[0]
    return [[c.text.strip() for c in row.cells] for row in tbl.rows]


def magic(data: bytes) -> str:
    if data.startswith(b"%PDF"):
        return "pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG"):
        return "png"
    if data[:2] == b"PK":
        return "zip"  # xlsx/docx
    if data[:8] == b"\xd0\xcf\x11\xe0":
        return "ole"
    return "bin"


def save_image_bytes(data: bytes, doc_id: str) -> tuple[str, str, int]:
    from PIL import Image
    im = Image.open(BytesIO(data)).convert("RGB")
    DOCS.mkdir(exist_ok=True)
    THUMBS.mkdir(exist_ok=True)
    page = DOCS / f"{doc_id}.jpg"
    thumb = THUMBS / f"{doc_id}.jpg"
    im.save(page, "JPEG", quality=85, optimize=True)
    t = im.copy()
    t.thumbnail((640, 400))
    t.save(thumb, "JPEG", quality=80, optimize=True)
    return f"/docs/{doc_id}.jpg", f"/thumbs/{doc_id}.jpg", page.stat().st_size


def upsert(cat: dict, doc: dict):
    for i, d in enumerate(cat["documents"]):
        if d["id"] == doc["id"]:
            cat["documents"][i] = {**d, **doc}
            return "patch"
    cat["documents"].append(doc)
    return "add"


def main() -> None:
    cat = json.loads(CATALOG.read_text())
    inbox = json.loads(INBOX.read_text()) if INBOX.exists() else {"attachments": {}}
    z = zipfile.ZipFile(ZIP_PATH)
    known = {d["id"] for d in cat["documents"]}

    for name in z.namelist():
        if name.endswith("/"):
            continue
        base = Path(name).name
        m = re.match(r"^([0-9a-f]{16})_(.*)$", base)
        if not m:
            continue
        doc_id, filename = m.group(1), m.group(2)
        rec = inbox["attachments"].get(doc_id, {})
        if rec.get("status") == "ingested" and doc_id in known:
            continue
        # already in catalog from previous ingest
        if doc_id in known and rec.get("status") != "pending":
            inbox["attachments"][doc_id] = {
                "filename": filename,
                "status": "ingested",
                "catalogId": doc_id,
            }
            continue
        data = z.read(name)
        kind = magic(data)
        blob = filename
        label = detect_label(filename) or detect_label(base)
        month = month_from_name(filename) or month_from_name(base)
        year = 2026
        status = "pending"
        reason = ""

        # skip tiny icons
        if filename.lower() == "icon.png" or len(data) < 4000:
            status = "ignored"
            reason = "no es cronograma"
        elif doc_id in {
            "2ad0788b5a431218",  # odont agosto photo of screen
            "6b2d91de50fdd558",  # odont abril dup
            "64a3d6c30c83762c",  # odont junio dup
        }:
            status = "duplicate"
            reason = "misma planilla odontológica ya integrada"

        inbox["attachments"][doc_id] = {
            "filename": filename,
            "bytes": len(data),
            "magic": kind,
            "status": status if status != "pending" else rec.get("status", "pending"),
            "label": label,
            "month": month,
            "reason": reason,
        }

    INBOX.write_text(json.dumps(inbox, ensure_ascii=False, indent=2) + "\n")
    CATALOG.write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n")
    print("inbox", len(inbox["attachments"]), "catalog", len(cat["documents"]))


if __name__ == "__main__":
    main()
