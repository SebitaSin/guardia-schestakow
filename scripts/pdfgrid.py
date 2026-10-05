"""Lectura de cronogramas en PDF con texto, usando la posición de cada fragmento."""
from __future__ import annotations
import re, unicodedata

WEEKDAYS = {"LUNES": 0, "MARTES": 1, "MIERCOLES": 2, "JUEVES": 3, "VIERNES": 4, "SABADO": 5, "DOMINGO": 6,
            "LUN": 0, "MAR": 1, "MIE": 2, "JUE": 3, "VIE": 4, "SAB": 5, "DOM": 6}


def _fold(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9Ñ/ ]", " ", text.upper())).strip()


def _fallback_width(ch, space):
    """Ancho aproximado (milésimas de cuerpo) cuando la fuente no lo informa."""
    if ch == " ":
        return space
    if ch in "MW":
        return 860.0
    if ch in "mw":
        return 780.0
    if ch in "IJijl.,;:'|!":
        return 270.0
    if ch in "frt-–":
        return 330.0
    if ch.isdigit():
        return 510.0
    return 610.0 if ch.isupper() else 500.0


def pdf_pages(path):
    """Por página: lista de [x, y, texto, tamaño, x final, ancho de un espacio]. y crece hacia abajo."""
    try:
        import pypdf
    except ImportError:  # copia incluida con la aplicación, sin instalar nada
        import os, sys
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
        import pypdf
    try:
        from pypdf._font import Font
    except Exception:  # versión de pypdf sin esa clase: se estima el ancho
        Font = None
    reader = pypdf.PdfReader(str(path))
    pages = []
    fonts = {}
    for page in reader.pages[:12]:
        runs = []

        def visit(text, cm, tm, font_dict, size, runs=runs):
            if not text or not text.strip():
                return
            x = cm[0] * tm[4] + cm[2] * tm[5] + cm[4]
            y = cm[1] * tm[4] + cm[3] * tm[5] + cm[5]
            scale = (abs(tm[0] * cm[0]) or 1.0) * float(size or 10)
            widths, space = None, 250.0
            if Font is not None and font_dict is not None:
                key = id(font_dict)
                if key not in fonts:
                    try:
                        font = Font.from_font_resource(font_dict)
                        fonts[key] = (font.character_widths or {}, float(font.space_width or 250))
                    except Exception:
                        fonts[key] = ({}, 250.0)
                widths, space = fonts[key]
            text = text.replace("\n", " ")
            char_width = lambda ch: float((widths or {}).get(ch) or _fallback_width(ch, space)) / 1000.0 * scale
            cursor = float(x)
            for piece in re.split(r"(\s{2,})", text):
                width = sum(char_width(ch) for ch in piece)
                if piece.strip():
                    runs.append([cursor, -float(y), piece, scale, cursor + width, space / 1000.0 * scale])
                cursor += width
        try:
            page.extract_text(visitor_text=visit)
        except Exception:
            runs = []
        pages.append(runs)
    return pages


def _lines(runs, tolerance=2.5):
    rows = []
    for run in sorted(runs, key=lambda r: (r[1], r[0])):
        if rows and abs(rows[-1][0] - run[1]) <= tolerance:
            rows[-1][1].append(run)
        else:
            rows.append([run[1], [run]])
    for row in rows:
        row.append(sorted(row[1], key=lambda r: r[0]))   # fragmentos originales
        row[1] = _words(row[1])                           # palabras y números ya unidos
    return rows


def _words(items):
    """Une los fragmentos pegados (letras de una misma palabra o número) en una sola pieza."""
    out = []
    for run in sorted(items, key=lambda r: r[0]):
        if out and run[0] - out[-1][4] < out[-1][5] * 0.8 and not out[-1][2].endswith(" ") and not run[2].startswith(" "):
            out[-1] = [out[-1][0], out[-1][1], out[-1][2] + run[2], out[-1][3], max(out[-1][4], run[4]), out[-1][5]]
        else:
            out.append(list(run))
    return out


def _join(runs):
    """Texto de una línea de celda, con los espacios reales."""
    out = ""
    for run in _words(runs):
        if out and not out.endswith(" ") and not run[2].startswith(" "):
            out += " "
        out += run[2]
    out = re.sub(r"[.…·_]{2,}", " ", out)
    out = re.sub(r"(?<=[A-Za-zÁÉÍÓÚÑáéíóúñ])\.(?=\d)", " ", out)
    return re.sub(r"\s+", " ", out).strip()


def _merge_wrapped(lines):
    out = []
    for line in lines:
        if out and re.fullmatch(r"[-–]?\s*\d{1,2}(?:[:.]\d{2})?\s*(?:hs?)?\*?", line, re.I) and re.search(r"\d\s*[-–]?\s*$", out[-1]):
            out[-1] = f"{out[-1]} {line}".strip()
        elif out and re.fullmatch(r"[-–]\s*\d{1,2}(?:[:.]\d{2})?.*", line) and re.search(r"\d\s*$", out[-1]) and len(line) < 12:
            out[-1] = f"{out[-1]} {line}".strip()
        else:
            out.append(line)
    cleaned = []
    for line in out:
        line = re.sub(r"\s*[-–]\s*", "-", line) if re.search(r"\d\s*[-–]\s*\d", line) else line
        line = re.sub(r"\s+", " ", line).strip(" -–·:")
        if line and line not in cleaned:
            cleaned.append(line)
    return cleaned


def _number_rows(rows, start_index):
    """Filas con números de día: [(índice, [(x, día, resto)])]."""
    found = []
    for index in range(start_index, len(rows)):
        numbers = []
        for x, _, text, *_ in rows[index][1]:
            match = re.match(r"^\s*(\d{1,2})(?!\d)(?![:.]\d)\s*(.*)$", text)
            if match and 1 <= int(match.group(1)) <= 31:
                numbers.append((x, int(match.group(1)), match.group(2).strip()))
        pure = [n for n in numbers if not n[2]] or numbers
        if pure:
            found.append((index, pure))
    return found


def calendar_from_pages(pages):
    """Grilla mensual (lunes a domingo). Devuelve (entradas [(día, líneas, día de semana)], título)."""
    entries, title = [], ""
    weekday_of_col = None
    last_day = 0
    for runs in pages:
        rows = _lines(runs)
        header_index, header = None, {}
        for index, (_, items, _raw) in enumerate(rows):
            found = {}
            for x, _, text, _, end, _ in items:
                for match in re.finditer(r"\S+", text):
                    word = _fold(match.group(0))
                    if word in WEEKDAYS and WEEKDAYS[word] not in found:
                        found[WEEKDAYS[word]] = x + (end - x) * match.start() / max(1, len(text))
            if len(found) == 7:
                header_index, header = index, found
                break
        if header_index is not None:
            ordered = sorted(header.items(), key=lambda kv: kv[1])
            weekday_of_col = [weekday for weekday, _ in ordered]
            if not title:
                title = " ".join(_join(items) for _, items, _ in rows[:header_index])
            last_day = 0
        elif weekday_of_col is None:
            continue
        body_start = header_index + 1 if header_index is not None else 0
        candidates = _number_rows(rows, body_start)
        # 1) Filas completas o parciales con números consecutivos.
        full = []
        for index, pure in candidates:
            values = [value for _, value, _ in pure]
            if len(values) >= 2 and all(b - a == 1 for a, b in zip(values, values[1:])):
                full.append((index, pure))
        if not full:
            continue
        widest = max(full, key=lambda item: len(item[1]))[1]
        gaps = sorted(b[0] - a[0] for a, b in zip(widest, widest[1:]))
        spacing = gaps[len(gaps) // 2]
        if header_index is not None:
            xs = [x for _, x in sorted(header.items(), key=lambda kv: kv[1])]
            votes = {}
            for _, pure in full:
                for x, value, _ in pure:
                    col = min(range(7), key=lambda j: abs(xs[j] - x))
                    first = (col - (value - 1)) % 7
                    votes[first] = votes.get(first, 0) + 1
            first_col = max(votes, key=votes.get)
            # Una fila de 7 números empieza siempre en la primera columna: eso manda sobre la cercanía.
            seven = next((pure for _, pure in full if len(pure) == 7), None)
            if seven:
                first_col = (0 - (seven[0][1] - 1)) % 7
        else:
            seven = next((pure for _, pure in full if len(pure) == 7), None)
            if not seven:
                continue
            first_col = (0 - (seven[0][1] - 1)) % 7
        column_of_day = lambda value, first_col=first_col: (first_col + value - 1) % 7
        per_col = {}
        for _, pure in full:
            for x, value, _ in pure:
                per_col.setdefault(column_of_day(value), []).append(x)
        anchors = {col: sorted(values)[len(values) // 2] for col, values in per_col.items()}
        for col in range(7):
            if col not in anchors:
                near = min(anchors.items(), key=lambda kv: abs(kv[0] - col))
                anchors[col] = near[1] + (col - near[0]) * spacing
        anchor = [anchors[c] for c in range(7)]
        if any(anchor[c + 1] - anchor[c] < spacing * 0.4 for c in range(6)):
            continue
        # 2) Filas con un solo número (mes que empieza en domingo o termina en lunes): sólo si están en su columna.
        day_rows = list(full)
        known = {index for index, _ in full}
        for index, pure in candidates:
            if index in known or len(pure) != 1:
                continue
            x, value, _ = pure[0]
            if abs(x - anchor[column_of_day(value)]) <= spacing * 0.2:
                before = max((p[-1][1] for i, p in full if i < index), default=last_day)
                after = min((p[0][1] for i, p in full if i > index), default=32)
                if before < value < after and (value == before + 1 or value == after - 1):
                    day_rows.append((index, pure))
        day_rows.sort(key=lambda item: item[0])
        ordered_days = [value for _, pure in day_rows for _, value, _ in pure]
        if ordered_days != sorted(set(ordered_days)) or (ordered_days and ordered_days[0] <= last_day and header_index is None):
            continue

        def build(mode):
            def col_of(run):
                x, end = run[0], run[4]
                if mode == "izquierda":
                    if x < anchor[0] - spacing * 0.5 or x >= anchor[6] + spacing * 1.02:
                        return None
                    col = 0
                    for j in range(7):
                        if x >= anchor[j] - spacing * 0.06:
                            col = j
                    return col
                center = (x + min(end, x + spacing)) / 2
                col = min(range(7), key=lambda j: abs(anchor[j] - center))
                return col if abs(anchor[col] - center) <= spacing * 0.75 else None
            cells_out = []
            for position, (index, pure) in enumerate(day_rows):
                next_index = day_rows[position + 1][0] if position + 1 < len(day_rows) else len(rows)
                cells = {column_of_day(value): [value, []] for _, value, _ in pure}
                for row_index in range(index, next_index):
                    per = {}
                    for run in rows[row_index][2]:
                        col = col_of(run)
                        if col is not None and col in cells:
                            per.setdefault(col, []).append(run)
                    for col, group in per.items():
                        text = _join(group)
                        if row_index == index:
                            text = re.sub(r"^\s*\d{1,2}(?!\d)(?![:.]\d)\s*", "", text, count=1)
                        if text:
                            cells[col][1].append(text)
                for col, (value, lines) in sorted(cells.items()):
                    cells_out.append((value, _merge_wrapped(lines), weekday_of_col[col]))
            return cells_out

        options = [build("izquierda"), build("centro")]
        best = max(options, key=lambda cells: sum(1 for _, lines, _ in cells if lines))
        entries.extend(cell for cell in best if cell[1])
        if ordered_days:
            last_day = ordered_days[-1]
    return entries, title


def matrix_from_page(runs):
    """Planillas "NOMBRE | 1 2 3 … 31" con una marca por día (M, T, N, F…)."""
    rows = _lines(runs)
    for index, (_, items, _raw) in enumerate(rows):
        days = [(x, int(text)) for x, _, text, *_ in items if re.fullmatch(r"\s*\d{1,2}\s*", text) and 1 <= int(text) <= 31]
        if len(days) < 20 or [d for _, d in days] != sorted(d for _, d in days):
            continue
        first_x = days[0][0]
        step = (days[-1][0] - days[0][0]) / max(1, len(days) - 1)
        title = " ".join(_join(row_items) for _, row_items, _ in rows[:index])
        table = [[""] + [str(d) for _, d in days]]
        for _, body, _raw in rows[index + 1:]:
            name_runs = [r for r in body if r[0] < first_x - step * 0.6]
            name = _join(name_runs)
            if not name or re.fullmatch(r"[\d\s.,]+", name):
                continue
            marks = [""] * len(days)
            for x, _, text, *_ in body:
                if x < first_x - step * 0.6:
                    continue
                col = min(range(len(days)), key=lambda j: abs(days[j][0] - x))
                if abs(days[col][0] - x) <= step * 0.6:
                    marks[col] = (marks[col] + " " + text.strip()).strip()
            if any(marks):
                table.append([name] + marks)
        return table, title
    return [], ""
