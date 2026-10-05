#!/usr/bin/env python3
"""Probe Gmail IMAP with the server-only app password. Never prints the secret."""
from __future__ import annotations

import os
import imaplib
import ssl
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(os.environ.get("APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATA_DIR = Path(os.environ.get("APP_DATA_DIR", ROOT / "var")).resolve()
STATUS = DATA_DIR / "mail" / "probe-status.json"
AR = timezone(timedelta(hours=-3))


def main() -> int:
    now = datetime.now(AR).isoformat(timespec="seconds")
    out = {
        "checkedAt": now,
        "imap": "unknown",
        "email": "",
        "error": "",
    }
    try:
        email = os.environ.get("HOSPITAL_IMAP_ACCOUNT", "").strip()
        pw = os.environ.get("HOSPITAL_IMAP_PASSWORD", "").replace(" ", "")
        if not email or not pw:
            raise RuntimeError("missing_credentials")
        out["email"] = email
        ctx = ssl.create_default_context()
        M = imaplib.IMAP4_SSL("imap.gmail.com", 993, ssl_context=ctx, timeout=20)
        try:
            M.login(email, pw)
            out["imap"] = "ok"
            M.select("INBOX", readonly=True)
            typ, data = M.search(None, "UNSEEN")
            unseen = data[0].split() if data and data[0] else []
            out["unseen"] = len(unseen)
            M.logout()
        except Exception as e:
            out["imap"] = "auth_failed"
            out["error"] = type(e).__name__
    except Exception as e:
        out["imap"] = "unknown"
        out["error"] = type(e).__name__
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    import json
    STATUS.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(out["imap"], out.get("error") or "ok")
    return 0 if out["imap"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
