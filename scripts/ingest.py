#!/usr/bin/env python3
"""Hospital ingest: any format → service + daily names.

Order: 1) title, 2) plantel (4 surnames), 3) sender.
Formats: .xlsx guardia grid, .doc OLE calendars, .docx name×day tables,
scanned pdf/jpg via already-rendered page images.
"""
from __future__ import annotations

import os
import calendar
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(os.environ.get("APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
CATALOG = ROOT / "src/data/catalog.json"

SHIFT_ON = {"M", "N", "T", "G", "PG", "TM", "TN"}
SHIFT_OFF = {"F", "DF", "L", "X", ""}


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
    if "GINECO" in f:
        return "ginecologia"
    if "OBSTETRIC" in f:
        return "obstetricia"
    if "CAMILLERO" in f or "MOVILIDAD" in f:
        return "movilidad"
    if "ENDOSCOP" in f:
        return "endoscopias"
    if "ANESTES" in f:
        return "anestesiologia"
    if "HEMOTER" in f or re.search(r"\bHT\b", f) or "ENCARGATURA DE TECNICOS" in f:
        return "hemoterapia"
    if "ODONTO" in f:
        return "odontologia"
    if "IMAGEN" in f:
        return "diagnostico-imagenes"
    if "NEONAT" in f:
        return "neonatologia"
    if "PEDIATR" in f:
        return "pediatria"
    if "PISO" in f and "CLINICA" in f:
        return "piso-clinica"
    if "GUARDIA CENTRAL" in f:
        return "guardia-clinica"
    return None


def parse_camillero_table(table: list[list[str]], year: int, month: int) -> list[dict]:
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
    for row in table[1:]:
        name = (row[0] or "").strip()
        if not name:
            continue
        for i, day in day_cols:
            if i >= len(row):
                continue
            cell = (row[i] or "").strip().upper()
            if not cell or cell in SHIFT_OFF:
                continue
            if cell in SHIFT_ON or re.fullmatch(r"[A-Z]{1,3}", cell):
                by_day[day].append(f"{name} {cell}" if cell in SHIFT_ON else name)
    days_in_month = calendar.monthrange(year, month)[1]
    shifts = []
    for day, names in sorted(by_day.items()):
        if 1 <= day <= days_in_month:
            shifts.append({"date": f"{year}-{month:02d}-{day:02d}", "text": " · ".join(names)})
    return shifts


def parse_ole_day_names(path: Path) -> list[tuple[int, str]]:
    import olefile

    ole = olefile.OleFileIO(str(path))
    if not ole.exists("WordDocument"):
        return []
    data = ole.openstream("WordDocument").read().decode("latin-1", errors="ignore")
    pairs = re.findall(r"\x07\s*(\d{1,2})\s*[\r\n]+\s*([^\x07\r\n]+)", data)
    out = []
    seen = set()
    for day, name in pairs:
        day_n = int(day)
        name = re.sub(r"\s+", " ", name).strip(" .")
        name = name.replace("Cabaña", "Cabaña")
        if day_n < 1 or day_n > 31:
            continue
        if not re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}", name):
            continue
        if day_n in seen:
            continue
        seen.add(day_n)
        if name.lower().startswith("dra ") and not name.lower().startswith("dra."):
            name = "Dra. " + name[4:]
        if name.lower().startswith("dr ") and not name.lower().startswith("dr."):
            name = "Dr. " + name[3:]
        out.append((day_n, name))
    return out


def parse_xlsx_guardia(path: Path) -> tuple[str | None, dict[int, list[str]]]:
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    header = [c.value for c in next(ws.iter_rows(min_row=4, max_row=4))]
    day_of: dict[int, int] = {}
    for i, h in enumerate(header):
        if not h:
            continue
        m = re.search(r"(\d{1,2})$", str(h).strip())
        if m:
            day_of[i] = int(m.group(1))
    period = ws["B3"].value
    by_day: dict[int, list[str]] = defaultdict(list)
    for row in ws.iter_rows(min_row=5, values_only=True):
        raw_name = row[0]
        if not raw_name or str(raw_name).lower().startswith("total"):
            continue
        display = re.sub(r"\s+", " ", str(raw_name)).strip()
        if "," in display:
            last, first = display.split(",", 1)
            display = f"{first.strip().title()} {last.strip().title()}"
        for i, cell in enumerate(row):
            if i not in day_of or not cell:
                continue
            raw = str(cell)
            codes = re.findall(r"\b(G|PG)\b", raw)
            if not codes:
                continue
            hours = re.findall(r"\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}", raw)
            label = display
            if hours:
                label = f"{display} ({hours[0]})"
            if "PG" in codes:
                label += " PG"
            by_day[day_of[i]].append(label)
    return str(period) if period else None, by_day


def shifts_from_days(year: int, month: int, by_day: dict[int, list[str]]) -> list[dict]:
    return [
        {"date": f"{year}-{month:02d}-{day:02d}", "text": " · ".join(names)}
        for day, names in sorted(by_day.items())
        if names
    ]


def patch_doc(cat: dict, doc_id: str, **fields) -> None:
    for d in cat["documents"]:
        if d["id"].startswith(doc_id) or d["id"] == doc_id:
            d.update(fields)
            print(f"patched {d['id'][:12]} {d['title'][:40]} shifts={len(d.get('shifts') or [])}")
            return
    raise SystemExit(f"missing {doc_id}")


def main() -> None:
    cat = json.loads(CATALOG.read_text())
    inbox = Path("/tmp/inbox")

    gineco = parse_ole_day_names(inbox / "ba62a675144991f8_GUARDIAS gineco Agosto 2026.doc")
    assert len(gineco) == 31, gineco
    patch_doc(
        cat,
        "ba62a675144991f8",
        departments=["ginecologia"],
        month=8,
        year=2026,
        shifts=[{"date": f"2026-08-{d:02d}", "text": n} for d, n in gineco],
        preview="calendar",
        notes=["GUARDIAS SERVICIO DE GINECOLOGIA AGOSTO 2026"],
    )

    period, days = parse_xlsx_guardia(inbox / "8b40d5ad43f05d60_Cronograma_8_2026.xlsx")
    patch_doc(
        cat,
        "8b40d5ad43f05d60",
        departments=["diagnostico-imagenes"],
        month=8,
        year=2026,
        shifts=shifts_from_days(2026, 8, days),
        preview="calendar",
        notes=[period or "Cronograma_8_2026", "ENCARGATURA DE TECNICOS"],
    )

    julio_xlsx = next(inbox.glob("*Cronograma_7*"))
    period7, days7 = parse_xlsx_guardia(julio_xlsx)
    patch_doc(
        cat,
        "5f3edc4677c67165",
        departments=["diagnostico-imagenes"],
        month=7,
        year=2026,
        shifts=shifts_from_days(2026, 7, days7),
        preview="calendar",
        notes=[period7 or "Cronograma_7_2026"],
    )

    for prefix, year, month in [("0dd2320989e28e8c", 2026, 7), ("d54d111df13a45cf", 2026, 5)]:
        doc = next(d for d in cat["documents"] if d["id"].startswith(prefix[:8]))
        if doc.get("table"):
            patch_doc(cat, prefix[:8], shifts=parse_camillero_table(doc["table"], year, month))

    CATALOG.write_text(json.dumps(cat, ensure_ascii=False, indent=2) + "\n")
    print("wrote", CATALOG)


if __name__ == "__main__":
    main()
