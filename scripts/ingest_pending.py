#!/usr/bin/env python3
"""Lee los adjuntos descargados del correo y publica los cronogramas legibles.

Sólo biblioteca estándar: no depende de paquetes instalados ni de internet.
Regla de seguridad: lo que no se lee con certeza NO se publica; queda listado
como "sin leer" con el motivo, para que la interfaz lo muestre.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import os
import re
import struct
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
PARSER_VERSION = 4
# Lo que no se pudo leer y llegó antes de esta fecha es historia: no se procesa ni se lista como pendiente.
# Todo lo que llega desde esta fecha se procesa siempre.
BACKLOG_BEFORE = date(2026, 9, 21)

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
        (r"CLINICA MEDICA", "piso-clinica"), (r"RADIOLOG|DIAGNOSTICO POR IMAGEN", "diagnostico-imagenes"),
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


def _ole_stream_reader(data: bytes):
    """Lector mínimo de archivos compuestos de Office 97-2003 (sólo lo necesario para Word)."""
    if data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise ValueError("no es un archivo compuesto")
    size = 1 << struct.unpack_from("<H", data, 30)[0]
    mini_size = 1 << struct.unpack_from("<H", data, 32)[0]
    fat_count, dir_start, _, cutoff, minifat_start, _, difat_start, difat_count = struct.unpack_from("<8I", data, 44)
    per_sector = size // 4

    def sector(index: int) -> bytes:
        return data[(index + 1) * size:(index + 2) * size]

    difat = list(struct.unpack_from("<109I", data, 76))
    while difat_start < 0xFFFFFFFC and difat_count > 0:
        block = struct.unpack(f"<{per_sector}I", sector(difat_start))
        difat += block[:-1]
        difat_start = block[-1]
        difat_count -= 1
    fat: list[int] = []
    for index in difat[:fat_count]:
        if index < 0xFFFFFFFC:
            fat += struct.unpack(f"<{per_sector}I", sector(index))

    def chain(start: int, table) -> list[int]:
        out: list[int] = []
        while start < 0xFFFFFFFC and start < len(table) and len(out) <= len(table):
            out.append(start)
            start = table[start]
        return out

    def big(start: int) -> bytes:
        return b"".join(sector(index) for index in chain(start, fat))

    directory = big(dir_start)
    entries: dict[str, tuple[int, int]] = {}
    root = (0xFFFFFFFE, 0)
    for offset in range(0, len(directory) - 127, 128):
        entry = directory[offset:offset + 128]
        length = struct.unpack_from("<H", entry, 64)[0]
        if length < 2:
            continue
        name = entry[:length - 2].decode("utf-16-le", "replace")
        start, stream_size = struct.unpack_from("<II", entry, 116)
        if entry[66] == 5:
            root = (start, stream_size)
        else:
            entries[name] = (start, stream_size)
    mini = big(root[0])[:root[1]]
    raw_minifat = big(minifat_start) if minifat_start < 0xFFFFFFFC else b""
    minifat = struct.unpack(f"<{len(raw_minifat) // 4}I", raw_minifat)

    def stream(name: str) -> bytes:
        start, stream_size = entries[name]
        if stream_size < cutoff:
            return b"".join(mini[i * mini_size:(i + 1) * mini_size] for i in chain(start, minifat))[:stream_size]
        return big(start)[:stream_size]

    return stream


def _doc_text(data: bytes) -> str:
    stream = _ole_stream_reader(data)
    word = stream("WordDocument")
    if struct.unpack_from("<H", word, 0)[0] != 0xA5EC:
        raise ValueError("no es Word 97-2003")
    flags = struct.unpack_from("<H", word, 10)[0]
    if flags & 0x0100:
        raise ValueError("documento protegido")
    table = stream("1Table" if flags & 0x0200 else "0Table")
    main_length = struct.unpack_from("<i", word, 0x4C)[0]
    clx_start, clx_length = struct.unpack_from("<II", word, 0x1A2)
    clx = table[clx_start:clx_start + clx_length]
    pos, parts = 0, []
    while pos < len(clx):
        if clx[pos] == 1:
            pos += 3 + struct.unpack_from("<H", clx, pos + 1)[0]
            continue
        if clx[pos] != 2:
            break
        length = struct.unpack_from("<I", clx, pos + 1)[0]
        pieces = clx[pos + 5:pos + 5 + length]
        count = (length - 4) // 12
        bounds = struct.unpack_from(f"<{count + 1}I", pieces, 0)
        for index in range(count):
            where = struct.unpack_from("<I", pieces, (count + 1) * 4 + index * 8 + 2)[0]
            chars = bounds[index + 1] - bounds[index]
            if where & 0x40000000:
                start = (where & 0x3FFFFFFF) // 2
                parts.append(word[start:start + chars].decode("cp1252", "replace"))
            else:
                parts.append(word[where:where + chars * 2].decode("utf-16-le", "replace"))
        break
    if not parts:
        raise ValueError("sin texto")
    return "".join(parts)[:main_length]


def _doc_lines(text: str) -> list[str]:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    return [line.strip() for line in re.split(r"[\r\n]", cleaned) if line.strip()]


def read_doc(path: Path) -> tuple[list[str], list[list[list[str]]]]:
    """Word 97-2003 (.doc). En el texto cada celda termina en \\x07 y cada fila lleva una marca más.

    Sin las propiedades de párrafo no se distingue una celda vacía de un fin de fila, así que el ancho
    se toma de la primera fila (el encabezado) y se exige que todas las filas cierren igual. Si no
    cierran, no se devuelve nada: es preferible dejar el servicio en blanco a leer corrido de columna.
    """
    tokens = _doc_text(path.read_bytes()).split("\x07")
    if len(tokens) < 4:
        return _doc_lines(tokens[0]), []
    tail = tokens.pop()
    first = _doc_lines(tokens[0])
    titles, tokens[0] = first[:-1], (first[-1] if first else "")
    width = next((index for index, token in enumerate(tokens) if not token.strip()), 0)
    if width < 2:
        return titles + _doc_lines(tail), []
    rows, pos = [], 0
    while pos < len(tokens):
        row = tokens[pos:pos + width]
        mark = tokens[pos + width] if pos + width < len(tokens) else None
        if len(row) < width or mark is None or mark.strip():
            return titles + _doc_lines(tail), []
        rows.append(["\n".join(_doc_lines(cell)) for cell in row])
        pos += width + 1
    return titles + _doc_lines(tail), [rows]


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
                    return read_scanned_pdf(path, item)
        elif head[:2] == b"PK" and suffix in (".docx", ".bin", "."):
            titles, tables = read_docx(path)
            file_type = "docx"
        elif head[:2] == b"PK" and suffix == ".xlsx":
            titles, tables = read_xlsx(path)
            file_type = "xlsx"
        elif head.startswith(b"\xd0\xcf\x11\xe0") and suffix == ".xls" and (mail_day(item) or date.today()) >= BACKLOG_BEFORE:
            titles, tables = read_xls(path)
            file_type = "xls"
        elif head.startswith(b"\xd0\xcf\x11\xe0") and suffix == ".doc" and (mail_day(item) or date.today()) >= BACKLOG_BEFORE:
            titles, tables = read_doc(path)
            file_type = "doc"
        else:
            kind = "foto" if head[:3] == b"\xff\xd8\xff" or head.startswith(b"\x89PNG") else "formato antiguo de Office" if head.startswith(b"\xd0\xcf\x11\xe0") else "formato"
            if kind == "foto" and (mail_day(item) or date.today()) >= BACKLOG_BEFORE:
                return read_photo(path, item)
            return {"reason": f"{kind}: todavía sin lector automático"}
    except (zipfile.BadZipFile, KeyError, ET.ParseError, struct.error, ValueError, IndexError):
        return {"reason": "archivo dañado o protegido"}
    except Exception as exc:
        if head.startswith(b"%PDF"):
            return read_scanned_pdf(path, item)
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


def read_xls(path: Path) -> tuple[list[str], list[list[list[str]]]]:
    """Excel viejo (.xls). Misma salida que read_xlsx."""
    vendor = str(Path(__file__).resolve().parent / "vendor")
    if vendor not in sys.path:
        sys.path.insert(0, vendor)
    import xlrd
    book = xlrd.open_workbook(str(path))
    names, tables = [], []
    for sheet in book.sheets():
        rows = []
        for r in range(sheet.nrows):
            row = []
            for c in range(sheet.ncols):
                cell = sheet.cell(r, c)
                text = ""
                if cell.ctype == xlrd.XL_CELL_DATE:
                    try:
                        text = xlrd.xldate_as_datetime(cell.value, book.datemode).date().isoformat()
                    except Exception:
                        text = str(cell.value)
                elif cell.ctype == xlrd.XL_CELL_NUMBER:
                    text = str(int(cell.value)) if cell.value == int(cell.value) else str(cell.value)
                elif cell.ctype not in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK, xlrd.XL_CELL_ERROR):
                    text = str(cell.value)
                row.append(text.strip())
            if any(row):
                rows.append(row)
        if rows:
            names.append(sheet.name)
            tables.append(rows)
    return names, tables


def scanned_pdf_images(path: Path, max_pages: int = 2) -> list[bytes]:
    """Imagen más grande de cada una de las primeras páginas de un PDF escaneado (JPEG o PNG)."""
    vendor = str(Path(__file__).resolve().parent / "vendor")
    if vendor not in sys.path:
        sys.path.insert(0, vendor)
    from pypdf import PdfReader
    found = []
    for page in list(PdfReader(str(path)).pages)[:max_pages]:
        best = b""
        try:
            for image in page.images:
                data = image.data
                if (data[:3] == b"\xff\xd8\xff" or data.startswith(b"\x89PNG")) and len(data) > len(best):
                    best = data
        except Exception:
            continue
        if len(best) > 20_000:
            found.append(best)
    return found


def read_scanned_pdf(path: Path, item: dict) -> dict:
    """PDF sin texto (escaneado): se leen sus páginas como fotos."""
    reason = {"reason": "pdf escaneado o con formato no reconocido"}
    if (mail_day(item) or date.today()) < BACKLOG_BEFORE:
        return reason
    try:
        images = scanned_pdf_images(path)
    except Exception:
        return reason
    last = reason
    for image in images:
        last = read_photo(path, item, image=image)
        if "doc" in last:
            return last
    return last


def read_photo(path: Path, item: dict, image: bytes | None = None) -> dict:
    """Foto de una planilla: la transcribe la IA (una sola vez por imagen) y se publica sólo si pasa los controles."""
    import photo_reader
    digest = hashlib.sha256(image).hexdigest() if image is not None else item.get("sha256") or hashlib.sha256(path.read_bytes()).hexdigest()
    result = photo_reader.transcribe(path, digest, image=image)
    if "reason" in result:
        return result
    hint = " ".join([item.get("filename") or "", item.get("subject") or ""])
    hint_month, hint_year = explicit_month(hint)
    read = photo_reader.to_shifts(result["reading"], mail_day(item), hint_month, hint_year)
    if "reason" in read:
        return read
    department = detect_department(read["service"]) or detect_department(hint) \
        or next((d for d in (detect_department(label) for label in item.get("labels") or []) if d), None)
    title = Path(item.get("filename") or "").stem.strip() or (item.get("subject") or "Cronograma")
    return {"doc": {
        "id": item["id"], "title": title[:160], "filename": item.get("filename") or "", "departments": [department] if department else [],
        "kind": "cronograma", "month": read["month"], "year": read["year"], "fileType": "foto",
        "fileUrl": None, "thumbUrl": None, "pageImages": [], "preview": "calendar",
        "notes": ["Leída de una foto por IA: verificar contra la imagen."] + ([f"{read['unclear']} nombres dudosos."] if read["unclear"] else []),
        "flags": ["foto"], "calendar": None, "table": None, "shifts": read["shifts"], "photoPeople": read["people"], "bytes": int(item.get("bytes") or 0),
        "superseded": False,
        "source": {"mailDate": (mail_day(item) or date(1970, 1, 1)).isoformat(), "layout": "foto", "parser": PARSER_VERSION,
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
    # Las fotos no sirven de referencia para reconocer a otras planillas por sus nombres.
    for doc in [d for d in known if "foto" not in d["flags"]] + [d for d in bundled if d.get("departments") and d.get("shifts")]:
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


def resolve_unread(unread: list[dict], documents: list[dict], pending: list[dict]) -> None:
    """Archivo que no se pudo leer y no nombra el servicio: se asigna por quien lo manda.

    Primero el servicio del que ese remitente manda siempre; si no hay historia, lo que diga
    su dirección o el asunto. Si nada alcanza, queda sin servicio: no se inventa.
    """
    item_of = {item.get("id"): item for item in pending}
    by_sender: dict[str, dict[str, int]] = {}
    def count(sender: str, slug: str) -> None:
        if sender:
            by_sender.setdefault(sender, {})[slug] = by_sender.setdefault(sender, {}).get(slug, 0) + 1
    for doc in documents:
        if doc["departments"]:
            count(sender_address(doc["source"].get("sender") or ""), doc["departments"][0])
    for entry in unread:
        if entry["departments"]:
            count(sender_address((item_of.get(entry["id"]) or {}).get("from") or ""), entry["departments"][0])
    for entry in unread:
        if entry["departments"]:
            continue
        item = item_of.get(entry["id"]) or {}
        counts = by_sender.get(sender_address(item.get("from") or ""), {})
        best = max(counts, key=counts.get) if counts else None
        if best and counts[best] / sum(counts.values()) >= 0.8:
            entry["departments"], entry["departmentBy"] = [best], "remitente"
            continue
        guess = detect_department(" ".join([item.get("subject") or "", item.get("from") or ""]))
        if guess:
            entry["departments"], entry["departmentBy"] = [guess], "dirección del remitente"


PHOTO_MAX_UNCLEAR = 0.4  # después de comparar con planillas anteriores: más que esto no se publica
NOT_A_NAME = {"DRA", "LIC", "TEC", "RES", "HS", "DEL", "LOS", "LAS", "GUARDIA", "PASIVA", "ACTIVA", "NOCHE", "TARDE", "MANANA", "REEMPLAZO", "REFUERZO", "LICENCIA", "FERIADO", "DOMINGO", "SABADO"}


def _name_words(text: str) -> list[str]:
    return [word for word in re.findall(r"[^\W\d_]{3,}", text or "") if fold(word) not in NOT_A_NAME]


def photo_names_config() -> dict:
    """Nombres confirmados por servicio y meses en que las fotos se publican tal como se leen."""
    try:
        return json.loads((APP_ROOT / "server" / "photo-names.json").read_text("utf-8"))
    except Exception:
        return {}


def reference_names(slug: str, documents: list[dict], pending: list[dict]) -> dict[str, str]:
    """Nombres ya conocidos del servicio: nómina, planillas anteriores leídas de archivo y quienes mandan sus correos."""
    known: dict[str, str] = {}
    def add(text: str) -> None:
        for word in _name_words(text):
            known.setdefault(fold(word), word)
    try:
        staff = json.loads((APP_ROOT / "src" / "data" / "staff.json").read_text("utf-8")).get("services", {})
        for person in staff.get(slug) or []:
            add(person.get("name") or person.get("surname") or "")
    except Exception:
        pass
    try:
        bundled = json.loads((APP_ROOT / "src" / "data" / "catalog.json").read_text("utf-8")).get("documents", [])
    except Exception:
        bundled = []
    for doc in bundled + [d for d in documents if "foto" not in d.get("flags", [])]:
        if (doc.get("departments") or [None])[0] == slug:
            for shift in doc.get("shifts") or []:
                add(shift.get("text", ""))
    # Nombres que Sebastián confirmó a mano (server/photo-names.json).
    for name in (photo_names_config().get("confirmed") or {}).get(slug) or []:
        add(str(name))
    # Quien manda las planillas del servicio suele figurar en ellas.
    for item in pending:
        if detect_department(" ".join([item.get("filename") or "", item.get("subject") or ""])) == slug:
            add(re.sub(r"<.*", "", item.get("from") or ""))
    return known


def _closest(key: str, known: dict[str, str], cutoff: float) -> str | None:
    """El nombre conocido al que se parece `key`, sólo si hay uno claramente mejor que el resto."""
    import difflib
    # Nombre cortado en la foto ("CENTE" por "CENTENO"): vale si un solo conocido empieza así.
    if len(key) >= 4:
        starts = [name for name in known if name.startswith(key) and name != key]
        if len(starts) == 1:
            return starts[0]
    if len(key) <= 4:
        # Nombres cortos ("ZIN" por "SIN"): misma cantidad de letras y una sola distinta.
        near = [name for name in known if len(name) == len(key) and sum(a != b for a, b in zip(name, key)) == 1]
        return near[0] if len(near) == 1 else None
    ratio = lambda name: difflib.SequenceMatcher(None, key, name).ratio()
    close = sorted(((ratio(name), name) for name in known if abs(len(name) - len(key)) <= 3), reverse=True)[:2]
    if close and close[0][0] >= cutoff and (len(close) == 1 or close[0][0] - close[1][0] >= 0.08):
        return close[0][1]
    return None


def correct_name(name: str, known: dict[str, str], cutoff: float) -> tuple[str, bool]:
    """Devuelve el nombre con la grafía conocida y si quedó respaldado por un nombre conocido."""
    words, backed, significant = name.split(), 0, 0
    for index, word in enumerate(words):
        bare = word.strip(".,")
        if not re.fullmatch(r"[^\W\d_]{3,}", bare) or fold(bare) in NOT_A_NAME:
            continue
        significant += 1
        key = fold(bare)
        if key in known:
            backed += 1
            continue
        match = _closest(key, known, cutoff)
        if match:
            shown = known[match]
            shown = shown.upper() if bare.isupper() else shown[:1].upper() + shown[1:].lower() if shown.isupper() else shown
            words[index] = word.replace(bare, shown)
            backed += 1
    return " ".join(words), bool(significant) and backed == significant


def finalize_photos(documents: list[dict], unread: list[dict], pending: list[dict]) -> None:
    """Compara cada nombre leído de una foto con los nombres conocidos del servicio y arma el texto definitivo."""
    for doc in [d for d in documents if d.get("photoPeople") is not None]:
        people = doc.pop("photoPeople")
        slug = doc["departments"][0] if doc["departments"] else ""
        known = reference_names(slug, documents, pending) if slug else {}
        # Los nombres que la misma planilla repite sin dudas también sirven de referencia.
        sure: dict[str, int] = {}
        for rows in people.values():
            for name, _, unclear in rows:
                if not unclear:
                    for word in _name_words(name):
                        sure[word] = sure.get(word, 0) + 1
        for word, times in sure.items():
            if times >= 2:
                known.setdefault(fold(word), word)
        total = doubtful = fixed = 0
        shifts = []
        as_read = f"{doc['year']}-{doc['month']:02d}" in (photo_names_config().get("acceptAsRead") or [])
        for day in sorted(people):
            lines: list[str] = []
            for name, hours, unclear in people[day]:
                total += 1
                better, backed = correct_name(name, known, 0.66 if unclear else 0.8)
                if better != name:
                    fixed += 1
                if unclear and not backed and not as_read:
                    doubtful += 1
                    better = f"{better} (dudoso)"
                line = f"{better} {hours}".strip()
                if line not in lines:
                    lines.append(line)
            if lines:
                shifts.append({"date": day, "text": " · ".join(lines)})
        if total and doubtful / total > PHOTO_MAX_UNCLEAR:
            documents.remove(doc)
            unread.append({"id": doc["id"], "filename": doc["filename"], "mailDate": doc["source"]["mailDate"], "departments": doc["departments"],
                           "reason": "foto: demasiados nombres dudosos, no se publica"})
            continue
        doc["shifts"] = shifts
        doc["notes"] = ["Leída de una foto por IA: verificar contra la imagen."] \
            + ([f"{fixed} nombres ajustados con los nombres conocidos del servicio."] if fixed else []) \
            + ([f"{doubtful} nombres dudosos."] if doubtful else [])


def check_photo_names(documents: list[dict], unread: list[dict]) -> None:
    """Una foto leída cuyos nombres no se parecen a los de las planillas anteriores del servicio no se publica."""
    known: dict[str, set[str]] = {}
    for doc in documents:
        if doc["departments"] and "foto" not in doc["flags"]:
            known.setdefault(doc["departments"][0], set()).update(name_tokens(doc))
    for doc in [d for d in documents if "foto" in d["flags"] and d["departments"]]:
        names, mine = known.get(doc["departments"][0]), name_tokens(doc)
        if names and mine and len(mine & names) / len(mine) < 0.3:
            documents.remove(doc)
            unread.append({"id": doc["id"], "filename": doc["filename"], "mailDate": doc["source"]["mailDate"], "departments": doc["departments"],
                           "reason": "foto: los nombres no coinciden con las planillas anteriores del servicio"})


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
    # Planilla leída que no nombra el servicio y sin historia de lectura (típico de una foto): se asigna por quien la manda.
    orphans = [{"id": doc["id"], "departments": []} for doc in documents if not doc["departments"]]
    resolve_unread(orphans + unread, documents, pending)
    assigned = {entry["id"]: entry for entry in orphans if entry["departments"]}
    for doc in documents:
        if doc["id"] in assigned:
            doc["departments"] = assigned[doc["id"]]["departments"]
            doc["source"]["departmentBy"] = assigned[doc["id"]]["departmentBy"]
    finalize_photos(documents, unread, pending)
    check_photo_names(documents, unread)
    for doc in [d for d in documents if not d["departments"]]:
        documents.remove(doc)
        unread.append({"id": doc["id"], "filename": doc["filename"], "mailDate": doc["source"]["mailDate"], "departments": [],
                       "reason": "no se pudo determinar el servicio"})
    # Si el mismo cronograma llega más de una vez, vale el correo más nuevo.
    documents.sort(key=lambda d: d["source"]["mailDate"], reverse=True)
    typed = [doc for doc in documents if "foto" not in doc["flags"]]
    photos = [doc for doc in documents if "foto" in doc["flags"]]
    mark_superseded(typed)
    mark_superseded(photos)
    # Una foto nunca le gana a una planilla del mismo servicio y mes que llegó en Word, Excel o PDF.
    solid = {(doc["departments"][0], doc["year"], doc["month"]) for doc in typed if doc["departments"] and not doc["superseded"]}
    for doc in photos:
        if doc["departments"] and (doc["departments"][0], doc["year"], doc["month"]) in solid:
            doc["superseded"] = True
    limit = BACKLOG_BEFORE.isoformat()
    backlog = [entry for entry in unread if entry["mailDate"] < limit]
    unread = [entry for entry in unread if entry["mailDate"] >= limit]
    live = {"generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"), "parser": PARSER_VERSION,
            "documents": documents, "unread": unread, "backlog": backlog}
    atomic_json(OUT_DIR / "live.json", live)
    return {"read": len(documents), "unread": len(unread), "at": live["generatedAt"]}


if __name__ == "__main__":
    try:
        print(json.dumps(run(), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": type(exc).__name__}))
        raise SystemExit(2)
