#!/usr/bin/env python3
"""Reclamo automático de planillas de guardias por correo.

Regla (Sebastián, 6/10/2026): desde 3 días antes del mes se reclama una vez por día la
planilla del mes que empieza; desde el 1ro, dos veces por día. El reclamo de un servicio
se suspende solo cuando su planilla del mes llegó y pudo leerse. Va a las dos últimas
direcciones que mandaron planillas de ese servicio.

Con "enabled": false en server/reclamos-config.json no se envía nada: sólo se calcula y
se deja escrito a quién se le reclamaría (var/mail/reclamos.json).
"""
from __future__ import annotations

import json
import os
import re
import smtplib
import tempfile
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.utils import parsedate_to_datetime
from pathlib import Path

APP_ROOT = Path(os.environ.get("APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATA_DIR = Path(os.environ.get("APP_DATA_DIR", APP_ROOT / "var")).resolve()
MAIL_DIR = DATA_DIR / "mail"
CONFIG_FILE = APP_ROOT / "server" / "reclamos-config.json"
STATE_FILE = MAIL_DIR / "reclamos.json"
CONTROL_FILE = MAIL_DIR / "reclamos-control.json"  # cancelaciones hechas desde la pantalla: {"paused": {servicio: "AAAA-MM"}}
ACCOUNT = os.environ.get("HOSPITAL_IMAP_ACCOUNT", "").strip()
PASSWORD = os.environ.get("HOSPITAL_IMAP_PASSWORD", "").strip()
MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
DEFAULTS = {"enabled": False, "exclude": [], "hours": [8, 16], "leadDays": 3, "maxRecipients": 2, "activeWithinDays": 120}
LAST_HOUR = 20  # después de las 20 no se manda nada
MAX_FAILURES_PER_DAY = 3
AUTOMATIC = re.compile(r"no-?reply|mailer-daemon|notification|postmaster", re.I)


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return fallback


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, path)


def address(value: str) -> str:
    match = re.search(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", value or "")
    return match.group(0).lower() if match else ""


def mail_day(item: dict) -> date | None:
    try:
        return parsedate_to_datetime(item.get("date") or "").date()
    except (TypeError, ValueError):
        return None


def target_month(today: date, lead_days: int, slots: int) -> tuple[int, int, int]:
    """(año, mes, envíos por día). En los días previos al mes sólo se reclama el mes que viene."""
    first_next = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    if 0 < (first_next - today).days <= lead_days:
        return first_next.year, first_next.month, 1
    return today.year, today.month, slots


def senders_by_service(live: dict, pending: list, own: str) -> dict[str, list[tuple[date, str]]]:
    """Por servicio, quién mandó planillas (leídas o no) y cuándo."""
    service_of: dict[str, list[str]] = {}
    for group in ("documents", "unread", "backlog"):
        for entry in live.get(group) or []:
            if entry.get("id"):
                service_of.setdefault(entry["id"], []).extend(entry.get("departments") or [])
    found: dict[str, list[tuple[date, str]]] = {}
    for item in pending:
        who, day = address(item.get("from") or ""), mail_day(item)
        if not who or not day or who == own.lower() or AUTOMATIC.search(who):
            continue
        for slug in set(service_of.get(item.get("id") or "", [])):
            found.setdefault(slug, []).append((day, who))
    return found


def loaded(live: dict, slug: str, year: int, month: int) -> bool:
    return any(slug in (doc.get("departments") or []) and doc.get("year") == year and doc.get("month") == month and doc.get("shifts")
               for doc in live.get("documents") or [])


def build_plan(now: datetime, live: dict, pending: list, state: dict, config: dict, own: str, names: dict[str, str], paused: dict | None = None) -> dict:
    today = now.date()
    hours = sorted(int(h) for h in config["hours"])
    year, month, per_day = target_month(today, int(config["leadDays"]), len(hours))
    key_month = f"{year}-{month:02d}"
    passed = [h for h in hours[:per_day] if now.hour >= h] if now.hour < LAST_HOUR else []
    services: dict[str, dict] = {}
    for slug, seen in sorted(senders_by_service(live, pending, own).items()):
        seen.sort(reverse=True)
        if (today - seen[0][0]).days > int(config["activeWithinDays"]):
            continue  # hace meses que el servicio no manda nada por correo: no se le reclama solo
        recipients: list[str] = []
        for _, who in seen:
            if who not in recipients:
                recipients.append(who)
        sent = (state.get("sent") or {}).get(f"{key_month}|{slug}", [])
        sent_today = [stamp for stamp in sent if stamp.startswith(today.isoformat())]
        failures = (state.get("failures") or {}).get(f"{today.isoformat()}|{slug}", 0)
        if slug in config["exclude"]:
            status = "excluido"
        elif loaded(live, slug, year, month):
            status = "recibida"
        elif (paused or {}).get(slug) == key_month:
            status = "cancelado"  # cancelado a mano para este mes; el mes siguiente vuelve solo
        else:
            status = "pendiente"
        services[slug] = {"name": names.get(slug, slug), "to": recipients[: int(config["maxRecipients"])], "status": status,
                          "sent": len(sent), "sentToday": len(sent_today), "lastSent": sent[-1] if sent else None,
                          "due": status == "pendiente" and len(sent_today) < len(passed) and failures < MAX_FAILURES_PER_DAY}
    return {"month": key_month, "perDay": per_day, "hours": hours[:per_day], "services": services}


def compose(slug_name: str, recipients: list[str], year: int, month: int, own: str) -> EmailMessage:
    period = f"{MONTHS[month - 1]} {year}"
    message = EmailMessage()
    message["From"] = own
    message["To"] = ", ".join(recipients)
    message["Subject"] = f"Planilla de guardias de {period} - {slug_name}"
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(
        f"Buenos días.\n\nTodavía no tenemos cargada la planilla de guardias de {period} de {slug_name}.\n"
        f"Por favor enviarla a esta casilla ({own}), de ser posible en Word, Excel o PDF y no como foto, para que se cargue sola.\n"
        "Si ya la mandaron como foto, les pedimos reenviarla en alguno de esos formatos.\n\n"
        "Este aviso es automático y deja de enviarse cuando la planilla queda cargada.\n\nMuchas gracias.\nHospital Schestakow\n")
    return message


def service_names() -> dict[str, str]:
    """Nombres de los servicios, tomados de la lista de la app."""
    try:
        text = (APP_ROOT / "src" / "data" / "departments.ts").read_text("utf-8")
    except OSError:
        return {}
    return dict(re.findall(r'slug:\s*"([^"]+)",\s*name:\s*"([^"]+)"', text))


def run(now: datetime | None = None, smtp_factory=smtplib.SMTP_SSL) -> dict:
    now = now or datetime.now()
    config = {**DEFAULTS, **load_json(CONFIG_FILE, {})}
    live = load_json(DATA_DIR / "catalog" / "live.json", {})
    pending = load_json(MAIL_DIR / "pending.json", [])
    state = load_json(STATE_FILE, {})
    state.setdefault("sent", {})
    state.setdefault("failures", {})
    if not live.get("documents"):
        return {"status": "sin_catalogo"}  # sin lectura del correo no se puede saber qué falta: no se reclama a nadie
    plan = build_plan(now, live, pending, state, config, ACCOUNT, service_names(), load_json(CONTROL_FILE, {}).get("paused") or {})
    year, month = (int(part) for part in plan["month"].split("-"))
    due = [(slug, info) for slug, info in plan["services"].items() if info["due"] and info["to"]]
    sent_now = failed = 0
    if config["enabled"] and due and ACCOUNT and PASSWORD:
        try:
            with smtp_factory("smtp.gmail.com", 465, timeout=30) as client:
                client.login(ACCOUNT, PASSWORD)
                for slug, info in due:
                    try:
                        client.send_message(compose(info["name"], info["to"], year, month, ACCOUNT))
                        stamp = now.isoformat(timespec="minutes")
                        state["sent"].setdefault(f"{plan['month']}|{slug}", []).append(stamp)
                        info.update({"sent": info["sent"] + 1, "sentToday": info["sentToday"] + 1, "lastSent": stamp, "due": False})
                        sent_now += 1
                    except Exception:
                        failed += 1
                        key = f"{now.date().isoformat()}|{slug}"
                        state["failures"][key] = state["failures"].get(key, 0) + 1
        except Exception as exc:
            failed += len(due) - sent_now
            state["lastError"] = {"at": now.isoformat(timespec="minutes"), "type": type(exc).__name__}
            for slug, _ in due[sent_now:]:
                key = f"{now.date().isoformat()}|{slug}"
                state["failures"][key] = state["failures"].get(key, 0) + 1
    today_key = now.date().isoformat()
    state["failures"] = {key: count for key, count in state["failures"].items() if key.startswith(today_key)}
    state.update({"at": now.isoformat(timespec="minutes"), "enabled": bool(config["enabled"]), **plan})
    atomic_json(STATE_FILE, state)
    return {"status": "ok", "enabled": bool(config["enabled"]), "month": plan["month"], "due": len(due), "sent": sent_now, "failed": failed}


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False))
