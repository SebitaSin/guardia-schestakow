#!/usr/bin/env python3
"""Manda por correo, desde la casilla del hospital, el aviso de cambio de nivel de alerta.

Lo llama el servidor con el aviso en JSON por la entrada estándar. No envía nada si
server/avisos-config.json no tiene "activo": true y al menos un destinatario.
"""
from __future__ import annotations

import json
import os
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

APP_ROOT = Path(os.environ.get("APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
NAMES = {"verde": "VERDE", "amarillo": "AMARILLO", "naranja": "NARANJA", "rojo": "ROJO"}


def build(notice: dict, sender: str, recipients: list[str]) -> EmailMessage:
    level = NAMES.get(notice.get("a"), str(notice.get("a")).upper())
    message = EmailMessage()
    message["From"] = sender
    message["To"] = ", ".join(recipients)
    message["Subject"] = f"Hospital Schestakow - nivel de alerta {level}"
    message["Auto-Submitted"] = "auto-generated"
    reasons = "\n".join(f"- {item.get('origen')}: {item.get('texto')}" for item in notice.get("motivos") or []) or "- Sin motivos de alerta vigentes."
    message.set_content(
        f"El nivel de alerta para San Rafael pasó de {NAMES.get(notice.get('de'), notice.get('de'))} a {level}.\n\n{reasons}\n\n"
        "Detalle en la aplicación, en Contingencia. Aviso automático: se envía sólo cuando el nivel cambia.\n")
    return message


def main(stream=sys.stdin, smtp_factory=smtplib.SMTP_SSL) -> int:
    notice = json.load(stream)
    try:
        config = json.loads((APP_ROOT / "server" / "avisos-config.json").read_text("utf-8")).get("correo") or {}
    except (OSError, ValueError):
        config = {}
    recipients = [str(address).strip() for address in config.get("para") or [] if "@" in str(address)]
    account, password = os.environ.get("HOSPITAL_IMAP_ACCOUNT", "").strip(), os.environ.get("HOSPITAL_IMAP_PASSWORD", "").strip()
    if config.get("activo") is not True or not recipients or not account or not password:
        print(json.dumps({"enviado": False, "motivo": "apagado o sin destinatarios"}))
        return 0
    with smtp_factory("smtp.gmail.com", 465, timeout=30) as client:
        client.login(account, password)
        client.send_message(build(notice, account, recipients))
    print(json.dumps({"enviado": True, "destinatarios": len(recipients)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
