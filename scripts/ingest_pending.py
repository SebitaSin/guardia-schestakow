#!/usr/bin/env python3
"""Lee los adjuntos descargados del correo y publica los cronogramas legibles.

Sólo biblioteca estándar: no depende de paquetes instalados ni de internet.
Regla de seguridad: lo que no se lee con certeza NO se publica; queda listado
como "sin leer" con el motivo, para que la interfaz lo muestre.
"""
from __future__ import annotations

import calendar
import json
import os
import re
import sys
import tempfile
import unicodedata
import zipfile
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

APP_ROOT = Path(os.environ.get("APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATA_DIR = Path(os.environ.get("APP_DATA_DIR", APP_ROOT / "var")).resolve()
MAIL_DIR = DATA_DIR / "mail"
OUT_DIR = Path(os.environ.get("APP_CATALOG_DIR", DATA_DIR / "catalog")).resolve()
PARSER_VERSION = 3

MONTHS = {"ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4, "MAYO": 5, "JUNIO": 6, "JULIO": 7, "AGOSTO": 8,
          "SEPTIEMBRE": 9, "SETIEMBRE": 9, "OCTUBRE": 10, "NOVIEMBRE": 11, "DICIEMBRE": 12}
WEEKDAYS = {"LUNES": 0, "MARTES": 1, "MIERCOLES": 2, "JUEVES": 3, "VIERNES": 4, "SABADO": 5, "DOMINGO": 6,
            "LUN": 0, "MAR": 1, "MIE": 2, "JUE": 3, "VIE": 4, "SAB": 5, "DOM": 6}
SHIFT_ON = {"M", "N", "T", "G", "PG", "TM", "TN", "MA", "TA", "NA", "MANANA", "TARDE", "NOCHE"}
SHIFT_OFF = {"", "F", "DF", "L", "X", "A", "R", "FR", "LIC", "FRANCO"}
GENERIC_HEADERS = {"", "DIA", "DIAS", "FECHA", "FECHAS", "NOMBRE", "APELLIDO Y NOMBRE", "PROFESIONAL", "GUARDIA"}


def fold(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9Ñ/ ]", " ", text.upper())).strip()


def detect_department(text: str) -> str | None:
    f = fold(text)
    rules = [
        (r"\bTIP\b|TERAPIA INTENSIVA PEDIATR", "tip"), (r"\bUTIA\b|TERAPIA INTENSIVA|\bUTI\b", "terapia-intensiva"),
        (r"\bUCCYQ\b|CUIDADOS CRITICOS Y QUEMAD", "uccyq"), (r"\bUCIQ\b", "uciq"), (r"\bUCO\b|UNIDAD CORONARIA", "uco"),
        (r"PISO.*CLINICA|CLINICA.*PISO", "piso-clinica"), (r"GUARDIA CENTRAL|GUARDIA.*CLINICA MEDICA|CLINICA MEDICA.*GUARDIA", "guardia-clinica"),
        (r"GINECO", "ginecologia"), (r"OBSTETRIC", "obstetricia"), (r"HEMOTER|ENCARGATURA DE TECNICOS", "hemoterapia"),
        (r"ODONTO", "odontologia"), (r"MANTENIMIENTO|ELECTRICISTA|PLOMERO", "mantenimiento"), (r"PORTERIA", "porteria"),
        (r"MENSAJERIA", "mensajeria"), (r"ALBERGUE", "albergue"), (r"ESTERILIZ", "esterilizacion"), (r"ANESTES", "anestesiologia"),
        (r"ENDOSCOP", "endoscopias"), (r"CAMILLERO|MOVILIDAD", "movilidad"), (r"BIOQUIM|LABORATORIO", "laboratorio"),
        (r"NEONAT", "neonatologia"), (r"CIRUGIA PEDIATR", "cirugia-pediatrica"), (r"PEDIATR", "pediatria"),
        (r"\bCIRUGIA\b|\bCIRUJANO", "cirugia"), (r"KINESIO", "kinesiologia"), (r"SALUD MENTAL", "salud-mental"),
        (r"CLINICA MEDICA", "piso-clinica"),
    ]
    for pattern, slug in rules:
        if re.search(pattern, f):
            return slug
    return None


# ---------------------------------------------------------------------------
# Lectura de archivos (docx / xlsx son zip + XML)
# ---------------------------------------------------------------------------
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _para_text(paragraph) -> str:
    out = []
    for node in paragraph.iter():
        if node.tag == W + "t":
            out.append(node.text or "")
        elif node.tag == W + "tab":
            out.append(" ")
        elif node.tag in (W + "br", W + "cr"):
            out.append("\n")
    return "".join(out)


def _cell_text(cell) -> str:
    lines = []
    for child in cell:
        if child.tag == W + "p":
            lines.extend(_para_text(child).split("\n"))
        elif child.tag == W + "tbl":
            for inner in child.iter(W + "tc"):
                lines.extend(_cell_text(inner).split("\n"))
    return "\n".join(line.strip() for line in lines if line.strip())


def _docx_table(table) -> list[list[str]]:
    rows = []
    for tr in table.findall(W + "tr"):
        row: dict[int, str] = {}
        col = 0
        before = tr.find(f"{W}trPr/{W}gridBefore")
        if before is not None:
            col = int(before.get(W + "val", "0") or 0)
        for tc in tr.findall(W + "tc"):
            span_node = tc.find(f"{W}tcPr/{W}gridSpan")
            span = int(span_node.get(W + "val", "1") or 1) if span_node is not None else 1
            row[col] = _cell_text(tc)
            col += max(span, 1)
        rows.append(row)
    width = max((max(row) + 1 for row in rows if row), default=0)
    dense = [[row.get(i, "") for i in range(width)] for row in rows]
    keep = [i for i in range(width) if any(r[i] for r in dense)]
    return [[r[i] for i in keep] for r in dense]


def read_docx(path: Path) -> tuple[list[str], list[list[list[str]]]]:
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    body = root.find(W + "body")
    paragraphs, tables = [], []
    for child in (body if body is not None else []):
        if child.tag == W + "p":
            text = _para_text(child).strip()
            if text:
                paragraphs.append(text)
        elif child.tag == W + "tbl":
            tables.append(_docx_table(child))
    return paragraphs, tables


def _col_index(ref: str) -> int:
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def _date_styles(archive) -> set[int]:
    try:
        root = ET.fromstring(archive.read("xl/styles.xml"))
    except KeyError:
        return set()
    custom = {int(n.get("numFmtId")): n.get("formatCode", "") for n in root.iter(S + "numFmt")}
    result = set()
    xfs = root.find(S + "cellXfs")
    for index, xf in enumerate(xfs if xfs is not None else []):
        fmt = int(xf.get("numFmtId", "0"))
        code = re.sub(r'"[^"]*"|\[[^\]]*\]', "", custom.get(fmt, ""))
        if 14 <= fmt <= 22 or 45 <= fmt <= 47 or re.search(r"[dmy]", code, re.I):
            result.add(index)
    return result


def read_xlsx(path: Path) -> tuple[list[str], list[list[list[str]]]]:
    tables, names = [], []
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            for si in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall(S + "si"):
                shared.append("".join(t.text or "" for t in si.iter(S + "t")))
        try:
            names = [s.get("name", "") for s in ET.fromstring(archive.read("xl/workbook.xml")).iter(S + "sheet")]
        except KeyError:
            names = []
        date_styles = _date_styles(archive)
        sheets = sorted((n for n in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
                        key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)))
        for sheet in sheets:
            rows: dict[int, dict[int, str]] = {}
            for row in ET.fromstring(archive.read(sheet)).iter(S + "row"):
                r = int(row.get("r", "0") or 0)
                for cell in row.findall(S + "c"):
                    kind = cell.get("t", "n")
                    value = cell.find(S + "v")
                    text = ""
                    if kind == "s" and value is not None and (value.text or "").isdigit():
                        text = shared[int(value.text)] if int(value.text) < len(shared) else ""
                    elif kind == "inlineStr":
                        text = "".join(t.text or "" for t in cell.iter(S + "t"))
                    elif value is not None and value.text is not None:
                        text = value.text
                        if kind == "n":
                            try:
                                number = float(text)
                                if int(cell.get("s", "0") or 0) in date_styles and 20000 < number < 80000:
                                    text = (date(1899, 12, 30) + timedelta(days=int(number))).isoformat()
                                elif number == int(number):
                                    text = str(int(number))
                            except ValueError:
                                pass
                    text = text.strip()
                    if text:
                        rows.setdefault(r, {})[_col_index(cell.get("r", "A"))] = text
            if not rows:
                continue
            width = max(max(r) for r in rows.values()) + 1
            tables.append([[rows[r].get(i, "") for i in range(width)] for r in sorted(rows)])
    return names, tables


# ---------------------------------------------------------------------------
# Formatos de cronograma. Cada lector devuelve entradas (día, líneas, día de semana | None)
# ---------------------------------------------------------------------------
Entry = tuple[int, list[str], "int | None"]


def _weekday_of(cell: str) -> int | None:
    return WEEKDAYS.get(fold(cell).split(" ")[0] if cell else "")


def _clean_lines(lines: list[str]) -> list[str]:
    out = []
    for line in lines:
        line = re.sub(r"\s+", " ", line).strip(" -–·:")
        if line and line not in out:
            out.append(line)
    return out


def parse_calendar_grid(table: list[list[str]]) -> tuple[list[Entry], list[str]]:
    notes: list[str] = []
    header_at, columns = None, {}
    for index, row in enumerate(table):
        found = {i: _weekday_of(cell) for i, cell in enumerate(row) if _weekday_of(cell) is not None and len(fold(cell)) <= 12}
        if len(set(found.values())) >= 5:
            ordered = sorted(found)
            step_ok = all((found[b] - found[a]) % 7 == b - a for a, b in zip(ordered, ordered[1:]))
            if step_ok:
                first, last = ordered[0], ordered[-1]
                for col in range(max(0, first - 6), min(len(row), last + 7)):
                    if col not in found and len(found) < 7 and not fold(row[col]):
                        candidate = (found[first] + (col - first)) % 7
                        if candidate not in found.values():
                            found[col] = candidate
            header_at, columns = index, found
            break
    if header_at is None:
        return [], notes
    entries: list[Entry] = []
    waiting: dict[int, int] = {}
    order = sorted(columns)
    for row in table[header_at + 1:]:
        row_cells = []
        for col, weekday in columns.items():
            cell = row[col] if col < len(row) else ""
            lines = [l for l in cell.split("\n") if l.strip()]
            if not lines:
                continue
            match = re.match(r"^\s*(\d{1,2})(?!\d)[\s.\-:)]*(.*)$", lines[0])
            if match and 1 <= int(match.group(1)) <= 31:
                rest = _clean_lines(([match.group(2)] if match.group(2).strip() else []) + lines[1:])
                if rest:
                    row_cells.append([int(match.group(1)), rest, weekday, col])
                    waiting.pop(col, None)
                else:
                    waiting[col] = int(match.group(1))
            elif col in waiting:
                row_cells.append([waiting.pop(col), _clean_lines(lines), weekday, col])
        # Una grilla ordena los días por posición: si un número tipeado rompe la
        # secuencia de su fila, vale la posición.
        row_cells.sort(key=lambda item: item[3])
        for i, item in enumerate(row_cells):
            previous = row_cells[i - 1] if i > 0 else None
            following = row_cells[i + 1] if i + 1 < len(row_cells) else None
            expected = None
            rank = lambda cell: order.index(cell[3])
            if previous and following and following[0] - previous[0] == rank(following) - rank(previous):
                expected = previous[0] + (rank(item) - rank(previous))
            elif previous is None and following and len(row_cells) >= 3:
                third = row_cells[i + 2]
                if third[0] - following[0] == rank(third) - rank(following):
                    expected = following[0] - (rank(following) - rank(item))
            elif following is None and previous and len(row_cells) >= 3:
                third = row_cells[i - 2]
                if previous[0] - third[0] == rank(previous) - rank(third):
                    expected = previous[0] + (rank(item) - rank(previous))
            if expected is not None and expected != item[0] and 1 <= expected <= 31:
                notes.append(f"Día corregido por posición en la grilla: la celda decía {item[0]} y corresponde {expected}.")
                item[0] = expected
        entries.extend((day, lines, weekday) for day, lines, weekday, _ in row_cells)
    return entries, notes


def parse_range_list(table: list[list[str]]) -> list[tuple[int, int, int | None, int | None, list[str]]]:
    """Filas "1 AL 4 | NOMBRE". Devuelve (día inicial, día final, mes inicial, mes final, nombres)."""
    out = []
    singles = []
    pattern = re.compile(r"^(?:DEL? )?(\d{1,2})(?:/(\d{1,2}))?(?:/\d{2,4})? ?(?:AL|A|HASTA) ?(\d{1,2})(?:/(\d{1,2}))?(?:/\d{2,4})?$")
    for row in table:
        for index, cell in enumerate(row):
            match = pattern.match(fold(cell).replace(" / ", "/"))
            if not match:
                if index == 0 and re.fullmatch(r"\d{1,2}", cell.strip()) and 1 <= int(cell) <= 31:
                    names = _clean_lines([c.replace("\n", " / ") for i, c in enumerate(row) if i != 0 and c.strip()])
                    if names:
                        singles.append((int(cell), int(cell), None, None, names))
                continue
            names = _clean_lines([c.replace("\n", " / ") for i, c in enumerate(row) if i != index and c.strip()])
            if names:
                out.append((int(match.group(1)), int(match.group(3)), int(match.group(2)) if match.group(2) else None,
                            int(match.group(4)) if match.group(4) else None, names))
            break
    return out + singles if len(out) >= 2 else out


def parse_day_list(table: list[list[str]]) -> list[Entry]:
    if not table:
        return []
    width = max(len(row) for row in table)
    best_col, best_rows = None, []
    for col in range(width):
        rows, last = [], 0
        for index, row in enumerate(table):
            cell = row[col].strip() if col < len(row) else ""
            if re.fullmatch(r"\d{1,2}", cell) and last < int(cell) <= 31:
                rows.append(index)
                last = int(cell)
        if len(rows) > len(best_rows):
            best_col, best_rows = col, rows
    if best_col is None or len(best_rows) < 10:
        return []
    header = table[best_rows[0] - 1] if best_rows[0] > 0 else []
    entries: list[Entry] = []
    for index in best_rows:
        row = table[index]
        weekday, lines, first = None, [], True
        for col, cell in enumerate(row):
            cell = cell.strip()
            if col == best_col or not cell:
                continue
            if _weekday_of(cell) is not None and len(fold(cell)) <= 12:
                weekday = _weekday_of(cell)
                continue
            label = header[col].strip() if col < len(header) else ""
            text = cell.replace("\n", " / ")
            if first or fold(label) in GENERIC_HEADERS:
                lines.append(text)
            else:
                lines.append(f"{label.capitalize()}: {text}")
            first = False
        lines = _clean_lines(lines)
        if lines:
            entries.append((int(row[best_col]), lines, weekday))
    return entries


def parse_name_matrix(table: list[list[str]]) -> list[Entry]:
    letters = {"L": 0, "J": 3, "V": 4, "S": 5, "D": 6}
    for index, row in enumerate(table):
        day_cols = []
        for i, cell in enumerate(row):
            match = re.fullmatch(r"([LMXJVSD])?\s*(\d{1,2})", fold(cell))
            if match and 1 <= int(match.group(2)) <= 31:
                day_cols.append((i, int(match.group(2)), letters.get(match.group(1) or "")))
        if len(day_cols) < 15 or [d for _, d, _ in day_cols] != sorted(d for _, d, _ in day_cols):
            continue
        first_day_col = day_cols[0][0]
        cells = []
        for body in table[index + 1:]:
            name = next((re.sub(r"\s+", " ", c.replace("\n", " ")).strip() for c in body[:first_day_col] if c.strip() and not re.fullmatch(r"[\d.,]+", c.strip())), "")
            if not name or fold(name) in ("TOTAL", "TOTALES", "REFERENCIAS"):
                continue
            for col, day, weekday in day_cols:
                raw = body[col] if col < len(body) else ""
                lines = [l.strip() for l in raw.split("\n") if l.strip()]
                mark = re.sub(r"[^A-Z]", "", fold(lines[0])) if lines else ""
                hours = next((l for l in lines if re.search(r"\d{1,2}[:.]\d{2}\s*-\s*\d{1,2}[:.]\d{2}", l)), "")
                if mark in SHIFT_OFF or len(mark) > 6:
                    continue
                cells.append((day, weekday, name, mark, hours))
        # Si la planilla distingue guardias (G, PG) de turnos comunes, sólo cuentan las guardias.
        guard_marks = any("G" in mark for _, _, _, mark, _ in cells)
        by_day: dict[int, list[str]] = {}
        weekdays: dict[int, int | None] = {}
        for day, weekday, name, mark, hours in cells:
            if guard_marks and "G" not in mark:
                continue
            text = name + (f" ({hours})" if hours else "") + (f" {mark}" if mark not in ("G", "") and (hours or mark in SHIFT_ON) else "")
            by_day.setdefault(day, []).append(text)
            weekdays[day] = weekday
        if by_day:
            return [(day, lines, weekdays.get(day)) for day, lines in sorted(by_day.items())]
    return []


def _iso_dates(text: str) -> list[date]:
    out = []
    for y, m, d in re.findall(r"(20\d{2})-(\d{2})-(\d{2})", text):
        try:
            out.append(date(int(y), int(m), int(d)))
        except ValueError:
            pass
    return out


def parse_weekly_blocks(table: list[list[str]]) -> dict[date, list[str]]:
    """Bloques "DESDE: fecha" seguidos de filas ROL | APELLIDO | NOMBRE (guardias semanales)."""
    blocks: list[tuple[date, list[str]]] = []
    for row in table:
        cells = [c.strip() for c in row if c.strip()]
        if not cells:
            continue
        joined = " ".join(cells)
        if fold(cells[0]).startswith("DESDE") or (blocks == [] and False):
            dates = _iso_dates(joined)
            if dates:
                blocks.append((dates[0], []))
            continue
        if blocks and not _iso_dates(joined) and re.fullmatch(r"[A-ZÑ ]{4,30}", fold(cells[0])) and len(cells) >= 2:
            names = [c for c in cells[1:] if not re.fullmatch(r"[\d\s().+-]{6,}", c)]
            if names:
                blocks[-1][1].append(f"{cells[0].capitalize()}: {' '.join(names)}")
    blocks = [b for b in blocks if b[1]]
    if len(blocks) < 2:
        return {}
    blocks.sort(key=lambda b: b[0])
    out: dict[date, list[str]] = {}
    for index, (start, people) in enumerate(blocks):
        end = blocks[index + 1][0] if index + 1 < len(blocks) else start + timedelta(days=7)
        if not timedelta(days=1) <= end - start <= timedelta(days=10):
            end = start + timedelta(days=7)
        day = start
        while day < end:
            out[day] = list(people)
            day += timedelta(days=1)
    return out


def parse_date_pairs(table: list[list[str]], year_hint: int, month_hint: int) -> dict[date, list[str]]:
    """Filas "NOMBRE | 02/10 09/10": de guardia desde la primera fecha hasta la segunda."""
    out: dict[date, list[str]] = {}
    rows = 0
    for row in table:
        cells = [c for c in row if c.strip()]
        if len(cells) < 2:
            continue
        found = re.findall(r"(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?", " ".join(cells[1:]))
        name = re.split(r"\d", cells[0].replace("\n", " "))[0].strip(" /-")
        if len(found) != 2 or not name or re.search(r"\d{1,2}/\d{1,2}", cells[0]):
            continue
        points = []
        for d, m, y in found:
            year = (2000 + int(y) if y and len(y) == 2 else int(y)) if y else year_hint + (1 if int(m) < month_hint - 6 else -1 if int(m) > month_hint + 6 else 0)
            try:
                points.append(date(year, int(m), int(d)))
            except ValueError:
                points = []
                break
        if len(points) != 2 or not timedelta(days=1) <= points[1] - points[0] <= timedelta(days=16):
            continue
        rows += 1
        day = points[0]
        while day < points[1]:
            out.setdefault(day, []).append(name)
            day += timedelta(days=1)
    return out if rows >= 2 else {}


# ---------------------------------------------------------------------------
# Mes y año
# ---------------------------------------------------------------------------
def explicit_month(text: str) -> tuple[int | None, int | None]:
    f = fold(text)
    month = next((n for name, n in MONTHS.items() if re.search(rf"\b{name}\b", f)), None)
    year = None
    match = re.search(r"\b(20\d{2})\b", f)
    if match:
        year = int(match.group(1))
    elif month:
        short = re.search(r"\b(?:" + "|".join(MONTHS) + r")\s*(?:DE\s*)?(\d{2})\b", f)
        if short:
            year = 2000 + int(short.group(1))
    return month, year


def weekday_score(entries: list[Entry], year: int, month: int) -> tuple[int, int]:
    days_in = calendar.monthrange(year, month)[1]
    checked = [(day, wd) for day, _, wd in entries if wd is not None]
    good = sum(1 for day, wd in checked if day <= days_in and date(year, month, day).weekday() == wd)
    return good, len(checked)


def resolve_month(entries: list[Entry], hint_text: str, mail_date: date | None) -> tuple[int | None, int | None, str | None]:
    month, year = explicit_month(hint_text)
    base = mail_date or date.today()
    candidates = []
    if month:
        candidates.append((year or (base.year + 1 if month < base.month - 6 else base.year), month))
    following = (base.replace(day=1) + timedelta(days=32)).replace(day=1)
    previous = (base.replace(day=1) - timedelta(days=1)).replace(day=1)
    for y, m in ((following.year, following.month), (base.year, base.month), (previous.year, previous.month)):
        if (y, m) not in candidates:
            candidates.append((y, m))
    # Un título puede arrastrar el nombre de un mes viejo ("ABRIL … MES DE SEPTIEMBRE"): se prueban todos los nombrados.
    for name, n in MONTHS.items():
        if re.search(rf"\b{name}\b", fold(hint_text)) and not any(m == n for _, m in candidates):
            candidates.append((year or (base.year + 1 if n < base.month - 6 else base.year), n))
    has_weekdays = any(wd is not None for _, _, wd in entries)
    if has_weekdays:
        scored = [(weekday_score(entries, y, m), (y, m)) for y, m in candidates]
        (good, total), (y, m) = max(scored, key=lambda item: item[0][0])
        if total and good / total >= 0.9:
            named = {n for name, n in MONTHS.items() if re.search(rf"\b{name}\b", fold(hint_text))}
            if month and (y, m) != candidates[0] and m not in named:
                return None, None, "el mes escrito no coincide con los días de la semana del cronograma"
            return y, m, None
        return None, None, "los días de la semana no coinciden con ningún mes cercano"
    if month:
        return candidates[0][0], candidates[0][1], None
    return None, None, "no indica el mes"


# ---------------------------------------------------------------------------
# Un adjunto -> documento de catálogo
# ---------------------------------------------------------------------------
def mail_day(item: dict) -> date | None:
    try:
        return parsedate_to_datetime(item.get("date", "")).date()
    except Exception:
        return None


def read_attachment(path: Path, item: dict) -> dict:
    """Devuelve {"doc": ...} si se leyó con certeza o {"reason": ...} si no."""
    suffix = path.suffix.lower()
    with path.open("rb") as handle:
        head = handle.read(8)
    pdf_entries: list[Entry] = []
    pdf_layout = None
    try:
        if head.startswith(b"%PDF"):
            import pdfgrid
            pages = pdfgrid.pdf_pages(path)
            pdf_entries, pdf_title = pdfgrid.calendar_from_pages(pages)
            titles, tables, file_type = [pdf_title], [], "pdf"
            if pdf_entries:
                pdf_layout = "grilla"
            else:
                for runs in pages:
                    table, pdf_title = pdfgrid.matrix_from_page(runs)
                    if table:
                        tables.append(table)
                        titles.append(pdf_title)
                if not tables:
                    return {"reason": "pdf escaneado o con formato no reconocido"}
        elif head[:2] == b"PK" and suffix in (".docx", ".bin", "."):
            titles, tables = read_docx(path)
            file_type = "docx"
        elif head[:2] == b"PK" and suffix == ".xlsx":
            titles, tables = read_xlsx(path)
            file_type = "xlsx"
        else:
            kind = "foto" if head[:3] == b"\xff\xd8\xff" or head.startswith(b"\x89PNG") else "formato antiguo de Office" if head.startswith(b"\xd0\xcf\x11\xe0") else "formato"
            return {"reason": f"{kind}: todavía sin lector automático"}
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        return {"reason": "archivo dañado o protegido"}
    except Exception as exc:
        if head.startswith(b"%PDF"):
            return {"reason": "pdf escaneado o con formato no reconocido"}
        raise

    top_text = " ".join(" ".join(row) for table in tables for row in table[:4])
    hint = " ".join([item.get("filename") or "", item.get("subject") or "", " ".join(titles), top_text])
    notes: list[str] = []
    entries: list[Entry] = []
    ranges = []
    layout = pdf_layout
    entries.extend(pdf_entries)
    for table in ([] if pdf_entries else tables):
        grid, grid_notes = parse_calendar_grid(table)
        if grid:
            entries.extend(grid); notes.extend(grid_notes); layout = "grilla"
    if not entries:
        for table in tables:
            ranges.extend(parse_range_list(table))
        if ranges:
            layout = "rangos"
    if not entries and not ranges:
        for table in tables:
            found = parse_name_matrix(table)
            if found:
                entries.extend(found); layout = "matriz"
    if not entries and not ranges:
        for table in tables:
            found = parse_day_list(table)
            if found:
                entries.extend(found); layout = "lista"
    dated: dict[date, list[str]] = {}
    if not entries and not ranges:
        for table in tables:
            dated.update(parse_weekly_blocks(table))
        if dated:
            layout = "semanas"
    if not entries and not ranges and not dated:
        base = mail_day(item) or date.today()
        hint_month, hint_year = explicit_month(hint)
        for table in tables:
            dated.update(parse_date_pairs(table, hint_year or base.year, hint_month or base.month))
        if dated:
            layout = "fechas"
    if not entries and not ranges and not dated:
        return {"reason": "no se reconoció una tabla de guardias"}

    if dated:
        hint_month, hint_year = explicit_month(hint)
        counts: dict[tuple[int, int], int] = {}
        for day in dated:
            counts[(day.year, day.month)] = counts.get((day.year, day.month), 0) + 1
        year, month = max(counts, key=counts.get)
        if hint_month and (hint_year or year, hint_month) in counts:
            year, month = hint_year or year, hint_month
        problem = None
    else:
        year, month, problem = resolve_month(entries, hint, mail_day(item))
    if problem:
        return {"reason": problem}
    days_in = calendar.monthrange(year, month)[1]
    by_day: dict[int, list[str]] = {}
    if ranges:
        for start, end, start_month, end_month, names in ranges:
            if start_month and start_month != month:
                start = 1 if end_month == month else None
            if end_month and end_month != month:
                end = days_in if (start_month in (None, month)) else None
            if start is None or end is None:
                continue
            if end < start:
                end = days_in
            for day in range(start, min(end, days_in) + 1):
                by_day.setdefault(day, []).extend(n for n in names if n not in by_day.get(day, []))
    for day, lines, _ in entries:
        if 1 <= day <= days_in:
            target = by_day.setdefault(day, [])
            target.extend(line for line in lines if line not in target)
    if not by_day and not dated:
        return {"reason": "la tabla no tiene días del mes indicado"}
    seen_days = [day for day, _, _ in entries]
    if len(seen_days) != len(set(seen_days)) and layout == "grilla":
        return {"reason": "hay días repetidos en la grilla"}

    department = detect_department(" ".join([item.get("filename") or "", " ".join(titles), top_text])) \
        or detect_department(item.get("subject") or "") \
        or next((d for d in (detect_department(label) for label in item.get("labels") or []) if d), None) \
        or next((d for d in (detect_department(s) for s in item.get("services") or []) if d), None)
    folded = fold(hint)
    kind = "pasiva" if "PASIVA" in folded else "modificacion" if re.search(r"\bCAMBIO|MODIFIC", folded) else "cronograma"
    flags = [flag for flag, pattern in (("tentativo", "TENTATIV"), ("definitivo", "DEFINITIV"), ("actualizado", "ACTUALIZAD|CORREGID")) if re.search(pattern, folded)]
    shifts = [{"date": f"{year}-{month:02d}-{day:02d}", "text": " · ".join(lines)} for day, lines in sorted(by_day.items()) if lines]
    if dated:
        # Guardias semanales: se conservan también los días que pisan el mes vecino.
        shifts = [{"date": day.isoformat(), "text": " · ".join(lines)} for day, lines in sorted(dated.items()) if lines]
    title = Path(item.get("filename") or "").stem.strip() or (item.get("subject") or "Cronograma")
    return {"doc": {
        "id": item["id"], "title": title[:160], "filename": item.get("filename") or "", "departments": [department] if department else [],
        "kind": "cronograma" if kind == "modificacion" else kind, "month": month, "year": year, "fileType": file_type,
        "fileUrl": None, "thumbUrl": None, "pageImages": [], "preview": "calendar", "notes": notes[:10],
        "flags": flags + (["actualizado"] if kind == "modificacion" and "actualizado" not in flags else []),
        "calendar": None, "table": None, "shifts": shifts, "bytes": int(item.get("bytes") or 0),
        "superseded": False,
        "source": {"mailDate": (mail_day(item) or date(1970, 1, 1)).isoformat(), "layout": layout, "parser": PARSER_VERSION,
                   "sender": sender_address(item.get("from") or "")},
    }}


def sender_address(value: str) -> str:
    match = re.search(r"[\w.+-]+@[\w.-]+", value or "")
    return match.group(0).lower() if match else ""


def name_tokens(doc: dict) -> set[str]:
    words = set()
    for shift in doc.get("shifts") or []:
        words.update(w for w in fold(shift.get("text", "")).split(" ") if len(w) >= 4 and not w.isdigit())
    return words - {"REEMPLAZO", "REFUERZO", "GUARDIA", "PASIVA", "ACTIVA", "NOCHE", "TARDE", "MANANA"}


def resolve_departments(documents: list[dict]) -> None:
    """Si el archivo no nombra el servicio: primero el remitente habitual, después las personas."""
    by_sender: dict[str, dict[str, int]] = {}
    by_department: dict[str, set[str]] = {}
    known = [d for d in documents if d["departments"]]
    try:
        bundled = json.loads((APP_ROOT / "src" / "data" / "catalog.json").read_text("utf-8")).get("documents", [])
    except Exception:
        bundled = []
    for doc in known:
        sender = doc["source"].get("sender")
        if sender:
            counts = by_sender.setdefault(sender, {})
            counts[doc["departments"][0]] = counts.get(doc["departments"][0], 0) + 1
    for doc in known + [d for d in bundled if d.get("departments") and d.get("shifts")]:
        by_department.setdefault(doc["departments"][0], set()).update(name_tokens(doc))
    for doc in documents:
        if doc["departments"]:
            continue
        counts = by_sender.get(doc["source"].get("sender") or "", {})
        total = sum(counts.values())
        best = max(counts, key=counts.get) if counts else None
        if best and counts[best] / total >= 0.8:
            doc["departments"] = [best]
            doc["source"]["departmentBy"] = "remitente"
            continue
        mine = name_tokens(doc)
        scored = sorted(((len(mine & names) / len(mine), slug) for slug, names in by_department.items()), reverse=True) if mine else []
        if scored and scored[0][0] >= 0.6 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.25):
            doc["departments"] = [scored[0][1]]
            doc["source"]["departmentBy"] = "personas"


def mark_superseded(documents: list[dict]) -> None:
    """Mismo servicio y mes, mismas personas = versión nueva del mismo cronograma: vale la más reciente.
    Personas distintas = otro plantel del servicio (por ejemplo médicos y licenciados): se muestran ambos."""
    kept: dict[tuple, list[set[str]]] = {}
    for doc in documents:  # ya ordenados del más nuevo al más viejo
        key = (doc["departments"][0], doc["year"], doc["month"])
        mine = name_tokens(doc)
        clusters = kept.setdefault(key, [])
        same = any(mine and other and len(mine & other) / len(mine | other) >= 0.3 for other in clusters)
        doc["superseded"] = bool(same)
        if not same:
            clusters.append(mine)


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=1)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def mail_labels() -> dict[str, list[str]]:
    import sqlite3
    path = MAIL_DIR / "messages.sqlite3"
    if not path.exists():
        return {}
    out: dict[str, list[str]] = {}
    try:
        database = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=10)
        try:
            for message_id, mailbox in database.execute("SELECT message_id, mailbox FROM labels"):
                out.setdefault(message_id, []).append(mailbox)
        finally:
            database.close()
    except Exception:
        return {}
    return out


def find_file(item: dict) -> Path | None:
    matches = sorted((MAIL_DIR / "attachments").glob(f"{item.get('sha256', '')}.*"), key=lambda p: p.suffix == ".bin")
    return matches[0] if item.get("sha256") and matches else None


def run() -> dict:
    pending_path = MAIL_DIR / "pending.json"
    pending = json.loads(pending_path.read_text("utf-8")) if pending_path.exists() else []
    documents, unread = [], []
    labels = mail_labels()
    for item in pending:
        # La carpeta del correo donde está guardado el mensaje suele decir el servicio.
        item["labels"] = [name for name in [item.get("mailbox") or ""] + labels.get(item.get("messageId") or "", [])
                          if name and name.upper() != "INBOX" and not name.startswith("[")]
        info = {"id": item.get("id"), "filename": item.get("filename") or "", "mailDate": (mail_day(item) or date(1970, 1, 1)).isoformat(),
                "departments": [d for d in {detect_department(" ".join([item.get("filename") or "", item.get("subject") or ""] + (item.get("labels") or []) + (item.get("services") or [])))} if d]}
        path = find_file(item)
        if path is None:
            unread.append({**info, "reason": "el adjunto no está en disco"})
            continue
        try:
            result = read_attachment(path, item)
        except Exception as exc:  # un archivo raro nunca debe frenar a los demás
            result = {"reason": f"error de lectura ({type(exc).__name__})"}
        if "doc" in result:
            documents.append(result["doc"])
        else:
            unread.append({**info, "reason": result["reason"]})
    resolve_departments(documents)
    for doc in [d for d in documents if not d["departments"]]:
        documents.remove(doc)
        unread.append({"id": doc["id"], "filename": doc["filename"], "mailDate": doc["source"]["mailDate"], "departments": [],
                       "reason": "no se pudo determinar el servicio"})
    # Si el mismo cronograma llega más de una vez, vale el correo más nuevo.
    documents.sort(key=lambda d: d["source"]["mailDate"], reverse=True)
    mark_superseded(documents)
    live = {"generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"), "parser": PARSER_VERSION,
            "documents": documents, "unread": unread}
    atomic_json(OUT_DIR / "live.json", live)
    return {"read": len(documents), "unread": len(unread), "at": live["generatedAt"]}


if __name__ == "__main__":
    try:
        print(json.dumps(run(), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": type(exc).__name__}))
        raise SystemExit(2)
