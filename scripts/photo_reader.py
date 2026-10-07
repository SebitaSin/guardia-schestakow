#!/usr/bin/env python3
"""Lectura por IA de fotos de planillas de guardias que llegan por correo.

Autorizado por Sebastián el 6/10/2026 sólo para planillas de guardias (nombres de personal).
Cada imagen se envía una sola vez: el resultado queda guardado por su huella y no se vuelve a pagar.
Comparte el tope mensual de server/ai-config.json con la lectura de pizarras.
Lo que no se lee con certeza no se publica: el archivo queda como "sin leer" con el motivo.
"""
from __future__ import annotations

import base64
import calendar
import json
import os
import tempfile
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

APP_ROOT = Path(os.environ.get("APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATA_DIR = Path(os.environ.get("APP_DATA_DIR", APP_ROOT / "var")).resolve()
AI_DIR = DATA_DIR / "ai"
PROMPT_VERSION = 1
MAX_BYTES = 15 * 1024 * 1024
MIN_DAYS = 10          # menos días que esto no es una planilla mensual confiable
MAX_UNCLEAR = 0.6      # tope grueso; el control fino se hace después de comparar con planillas anteriores (ingest_pending)

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["is_schedule", "service", "month", "year", "legibility", "days", "observations"],
    "properties": {
        "is_schedule": {"type": "boolean"},
        "service": {"type": ["string", "null"]},
        "month": {"type": ["integer", "null"], "minimum": 1, "maximum": 12},
        "year": {"type": ["integer", "null"]},
        "legibility": {"type": "integer", "minimum": 0, "maximum": 100},
        "days": {"type": "array", "maxItems": 62, "items": {
            "type": "object", "additionalProperties": False, "required": ["day", "people"],
            "properties": {"day": {"type": "integer", "minimum": 1, "maximum": 31},
                           "people": {"type": "array", "maxItems": 30, "items": {
                               "type": "object", "additionalProperties": False, "required": ["name", "hours", "unclear"],
                               "properties": {"name": {"type": "string"}, "hours": {"type": ["string", "null"]}, "unclear": {"type": "boolean"}}}}}}},
        "observations": {"type": ["string", "null"]},
    },
}

PROMPT = (
    "La imagen es la foto o captura de una planilla mensual de guardias de un servicio de un hospital argentino. "
    "Transcribila con máxima fidelidad. Para cada día del mes devolvé las personas de guardia tal como están escritas "
    "(apellido y/o nombre, sin corregir ni completar). Si junto a la persona hay un horario o turno, ponelo en 'hours' "
    "con el formato HH-HH (por ejemplo 08-20, 20-08) o '24 hs'; si es una letra de turno (M, T, N) poné esa letra; si no hay, null. "
    "Si un nombre no se lee con seguridad, transcribí lo que se ve y marcá 'unclear': true. No inventes ni deduzcas nombres. "
    "'service' es el servicio tal como figura en el encabezado, o null si no figura. 'month' y 'year' sólo si están escritos. "
    "'legibility' es de 0 a 100 qué tan legible es la planilla completa. Si la imagen no es una planilla de guardias, "
    "devolvé is_schedule false y days vacío."
)


def _load(path: Path, fallback):
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return fallback


def _save(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, path)


def config() -> dict:
    file = _load(APP_ROOT / "server" / "ai-config.json", {})
    get = lambda key, default="": str(os.environ.get(key) or file.get(key) or default)
    return {"enabled": get("AI_ENABLED").lower() == "true" and str(file.get("AI_ALLOW_SCHEDULE_PHOTOS", "false")).lower() == "true",
            "key": os.environ.get("OPENAI_API_KEY", ""), "model": get("OPENAI_MODEL"),
            "budget": float(get("AI_MONTHLY_BUDGET_USD", "0") or 0), "calls": int(float(get("AI_MONTHLY_CALL_LIMIT", "0") or 0)),
            "daily": float(get("AI_DAILY_BUDGET_USD", "0") or 0),
            "in": float(get("AI_INPUT_USD_PER_MILLION", "0") or 0), "out": float(get("AI_OUTPUT_USD_PER_MILLION", "0") or 0)}


def _call_openai(cfg: dict, image: bytes) -> tuple[dict, int, int]:
    mime = "image/png" if image.startswith(b"\x89PNG") else "image/jpeg"
    body = {"model": cfg["model"], "store": False, "reasoning": {"effort": "low"}, "max_output_tokens": 12000,
            "input": [{"role": "user", "content": [
                {"type": "input_text", "text": PROMPT},
                {"type": "input_image", "detail": "high", "image_url": f"data:{mime};base64,{base64.b64encode(image).decode('ascii')}"}]}],
            "text": {"format": {"type": "json_schema", "name": "planilla_de_guardias", "strict": True, "schema": SCHEMA}}}
    request = urllib.request.Request("https://api.openai.com/v1/responses", data=json.dumps(body).encode("utf-8"),
                                     headers={"authorization": f"Bearer {cfg['key']}", "content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = json.loads(response.read().decode("utf-8"))
    text = next((part.get("text", "") for item in raw.get("output") or [] for part in item.get("content") or [] if part.get("type") == "output_text"), "")
    usage = raw.get("usage") or {}
    return json.loads(text), int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)


def transcribe(path: Path, digest: str, call=_call_openai, image: bytes | None = None) -> dict:
    """Devuelve la transcripción (guardada o nueva) o {"reason": ...} si no se pudo pedir."""
    cache_path = AI_DIR / "schedule-cache" / f"{digest}.json"
    cached = _load(cache_path, None)
    if cached and cached.get("promptVersion") == PROMPT_VERSION:
        return cached
    cfg = config()
    if not cfg["enabled"]:
        return {"reason": "foto: lectura por IA no habilitada"}
    if not (cfg["key"] and cfg["model"] and cfg["budget"] > 0 and cfg["calls"] > 0):
        return {"reason": "foto: falta la clave o la configuración de IA"}
    usage_path = AI_DIR / f"usage-{datetime.now(timezone.utc):%Y-%m}.json"
    usage = _load(usage_path, {"calls": 0, "inputTokens": 0, "outputTokens": 0, "estimatedUsd": 0})
    if usage["calls"] >= cfg["calls"] or usage["estimatedUsd"] >= cfg["budget"]:
        return {"reason": "foto: se alcanzó el tope mensual de IA"}
    # Tope diario compartido con las pizarras (día de Mendoza, UTC-3): si no entra una lectura más, espera a mañana.
    day = (datetime.now(timezone.utc) - timedelta(hours=3)).strftime("%Y-%m-%d")
    typical = usage["estimatedUsd"] / usage["calls"] if usage["calls"] else 0.012
    if cfg.get("daily", 0) > 0 and (usage.get("dias") or {}).get(day, 0) + typical > cfg["daily"]:
        return {"reason": "foto: se alcanzó el tope diario de IA; se lee mañana"}
    image = image if image is not None else path.read_bytes()
    if not image or len(image) > MAX_BYTES:
        return {"reason": "foto: tamaño de imagen no admitido"}
    try:
        parsed, tokens_in, tokens_out = call(cfg, image)
    except urllib.error.HTTPError as exc:
        return {"reason": f"foto: el servicio de IA respondió {exc.code}"}
    except Exception as exc:
        return {"reason": f"foto: no se pudo consultar la IA ({type(exc).__name__})"}
    cost = tokens_in * cfg["in"] / 1_000_000 + tokens_out * cfg["out"] / 1_000_000
    usage = _load(usage_path, usage)
    dias = dict(usage.get("dias") or {})
    dias[day] = dias.get(day, 0) + cost
    _save(usage_path, {"calls": usage["calls"] + 1, "inputTokens": usage["inputTokens"] + tokens_in,
                       "outputTokens": usage["outputTokens"] + tokens_out, "estimatedUsd": usage["estimatedUsd"] + cost, "dias": dias})
    result = {"promptVersion": PROMPT_VERSION, "model": cfg["model"], "at": datetime.now().astimezone().isoformat(timespec="seconds"),
              "usage": {"inputTokens": tokens_in, "outputTokens": tokens_out, "estimatedUsd": cost}, "reading": parsed}
    _save(cache_path, result)
    return result


def to_shifts(reading: dict, mail_date: date | None, hint_month: int | None, hint_year: int | None) -> dict:
    """Convierte la transcripción en guardias por día, o dice por qué no se publica."""
    if not reading.get("is_schedule"):
        return {"reason": "foto: no es una planilla de guardias"}
    if int(reading.get("legibility") or 0) < 60:
        return {"reason": "foto poco legible: no se publica"}
    base = mail_date or date.today()
    month = reading.get("month") or hint_month
    year = reading.get("year") or hint_year
    if year and year < 100:
        year += 2000  # "26" escrito en la planilla
    if not month:
        # Sin mes escrito: una planilla que llega después del 20 es la del mes siguiente.
        month = base.month % 12 + 1 if base.day > 20 else base.month
        year = year or (base.year + 1 if base.day > 20 and base.month == 12 else base.year)
    year = year or base.year
    if abs((year * 12 + month) - (base.year * 12 + base.month)) > 1:
        return {"reason": "foto: el mes leído no coincide con la fecha del correo"}
    days_in = calendar.monthrange(year, month)[1]
    by_day: dict[int, list[str]] = {}
    people: dict[str, list[list]] = {}
    total = unclear = 0
    for row in reading.get("days") or []:
        day = int(row.get("day") or 0)
        if not 1 <= day <= days_in:
            continue
        for person in row.get("people") or []:
            name = " ".join(str(person.get("name") or "").split())
            if not name:
                continue
            total += 1
            hours = " ".join(str(person.get("hours") or "").split())
            entry = [name, hours, bool(person.get("unclear"))]
            if entry not in people.setdefault(f"{year}-{month:02d}-{day:02d}", []):
                people[f"{year}-{month:02d}-{day:02d}"].append(entry)
            if person.get("unclear"):
                unclear += 1
                name = f"{name} (dudoso)"
            line = f"{name} {hours}".strip()
            if line not in by_day.setdefault(day, []):
                by_day[day].append(line)
    filled = {day: lines for day, lines in by_day.items() if lines}
    if len(filled) < MIN_DAYS:
        return {"reason": "foto: se leyeron muy pocos días"}
    if total and unclear / total > MAX_UNCLEAR:
        return {"reason": "foto: demasiados nombres dudosos, no se publica"}
    return {"year": year, "month": month, "service": reading.get("service") or "", "unclear": unclear, "people": people,
            "shifts": [{"date": f"{year}-{month:02d}-{day:02d}", "text": " · ".join(lines)} for day, lines in sorted(filled.items())]}
