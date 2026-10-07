#!/usr/bin/env python3
"""Sincronización IMAP incremental, de sólo lectura y con confirmación humana."""
from __future__ import annotations

import hashlib
import imaplib
import json
import os
import re
import sqlite3
import tempfile
import unicodedata
from contextlib import contextmanager
from datetime import datetime
from email import policy
from email.parser import BytesParser
from pathlib import Path

APP_ROOT = Path(os.environ.get("APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATA_ROOT = Path(os.environ.get("APP_DATA_DIR", APP_ROOT / "var")).resolve() / "mail"
ACCOUNT = os.environ.get("HOSPITAL_IMAP_ACCOUNT", "").strip()
PASSWORD = os.environ.get("HOSPITAL_IMAP_PASSWORD", "").strip()
# AUTO = todas las carpetas (etiquetas) de la casilla, no sólo la bandeja de entrada.
MAILBOX_SETTING = os.environ.get("HOSPITAL_IMAP_MAILBOXES", "AUTO").strip() or "AUTO"

TERMS = ("guardia", "cronograma", "cambio", "modificacion", "modificado", "actualizado", "parte")
SERVICES = (
    "clinica medica", "uco", "uccyq", "obstetricia", "ginecologia", "cirugia",
    "pediatria", "neonatologia", "terapia intensiva", "salud mental", "kinesiologia",
    "movilidad", "laboratorio", "bioquimica", "hemoterapia", "odontologia",
    "endoscopias", "anestesiologia", "diagnostico por imagenes",
)

# Archivos que pueden traer un cronograma, un cambio o un parte. Un adjunto de
# este tipo se guarda siempre, aunque el asunto no nombre un servicio conocido.
DOCUMENT_SUFFIXES = {".doc", ".docx", ".odt", ".rtf", ".xls", ".xlsx", ".ods", ".csv", ".pdf"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
MIN_IMAGE_BYTES = 30_000  # descarta logos y firmas incrustadas
SCHEMA_VERSION = 3

SCHEMA = """
CREATE TABLE IF NOT EXISTS processed_uids (
 account TEXT NOT NULL, mailbox TEXT NOT NULL, uidvalidity TEXT NOT NULL,
 uid INTEGER NOT NULL, message_id TEXT NOT NULL, relevant INTEGER NOT NULL,
 PRIMARY KEY(account, mailbox, uidvalidity, uid));
CREATE TABLE IF NOT EXISTS messages (
 message_id TEXT PRIMARY KEY, mailbox TEXT NOT NULL, subject TEXT,
 sender TEXT, date_header TEXT, received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (
 message_id TEXT NOT NULL, filename TEXT, content_type TEXT, size INTEGER NOT NULL,
 sha256 TEXT NOT NULL, path TEXT NOT NULL,
 PRIMARY KEY(message_id, sha256));
CREATE TABLE IF NOT EXISTS bodies (
 message_id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS labels (
 message_id TEXT NOT NULL, mailbox TEXT NOT NULL, PRIMARY KEY(message_id, mailbox));
CREATE TABLE IF NOT EXISTS skipped (
 message_id TEXT PRIMARY KEY, mailbox TEXT NOT NULL, subject TEXT,
 sender TEXT, date_header TEXT, reason TEXT NOT NULL, at TEXT NOT NULL);
"""


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def normalize(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value or "").lower()
    return "".join(char for char in folded if not unicodedata.combining(char))


def classify_guardia(subject: str, body: str, filenames: list[str]) -> tuple[bool, list[str]]:
    text = normalize(" ".join([subject or "", body or "", *filenames]))
    services = [service for service in SERVICES if service in text]
    return bool(services and any(term in text for term in TERMS)), services


def message_files(message) -> list[tuple[str, str, bytes]]:
    """Adjuntos reales de un mensaje, incluidos los de correos reenviados."""
    found = []
    for part in message.walk():
        if part.is_multipart():
            continue
        filename = str(part.get_filename() or "")
        if not filename:
            continue
        content = part.get_payload(decode=True)
        if not content or len(content) > 25 * 1024 * 1024:
            continue
        suffix = Path(filename).suffix.lower()
        if suffix in IMAGE_SUFFIXES and len(content) < MIN_IMAGE_BYTES:
            continue
        found.append((filename, part.get_content_type(), content))
    return found


def is_relevant(subject: str, body: str, filenames: list[str]) -> tuple[bool, list[str]]:
    """Ningún correo se descarta: todos pueden traer información útil. Se guarda y lo clasifica el lector."""
    relevant, services = classify_guardia(subject, body, filenames)
    if relevant:
        return True, services
    if any(Path(name).suffix.lower() in DOCUMENT_SUFFIXES | IMAGE_SUFFIXES for name in filenames):
        return True, services
    return True, services


def migrate(database) -> None:
    version = database.execute("PRAGMA user_version").fetchone()[0]
    if version < 3:
        # Los mensajes descartados por filtros anteriores se vuelven a evaluar una vez.
        with database:
            database.execute("DELETE FROM processed_uids WHERE relevant=0")
            database.execute("DELETE FROM skipped")
    if version < SCHEMA_VERSION:
        database.execute(f"PRAGMA user_version={SCHEMA_VERSION}")


def safe_suffix(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix) else ".bin"


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def record_error(code: str, exc: Exception | None = None) -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    event = {"at": now(), "code": code}
    if exc is not None:
        event["exception_type"] = type(exc).__name__
    with (DATA_ROOT / "errors.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event) + "\n")


@contextmanager
def exclusive_run():
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    with (DATA_ROOT / ".sync.lock").open("a+b") as handle:
        handle.seek(0, 2)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def checked(result: tuple[str, list]) -> list:
    status, data = result
    if status != "OK":
        raise RuntimeError("imap_command_failed")
    return data


def fetch_bytes(client, uid: int, section: str) -> bytes:
    for item in checked(client.uid("fetch", str(uid), section)):
        if isinstance(item, tuple) and isinstance(item[1], bytes):
            return item[1]
    raise RuntimeError("missing_fetch_payload")


def text_body(message) -> str:
    chunks = []
    for part in message.walk():
        if part.get_content_type() == "text/plain" and not part.get_filename():
            chunks.append(str(part.get_content(errors="replace")))
    return "\n".join(chunks)[:200_000]


def decode_mailbox(name: str) -> str:
    """Nombre legible de una carpeta IMAP (UTF-7 modificado), para reconocer el servicio."""
    import base64

    def chunk(match):
        if not match.group(1):
            return "&"
        raw = match.group(1).replace(",", "/")
        try:
            return base64.b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-16-be")
        except Exception:
            return match.group(0)
    return re.sub(r"&([A-Za-z0-9+,]*)-", chunk, name)


def selected_mailboxes(client) -> list[str]:
    if MAILBOX_SETTING not in ("*", "AUTO"):
        return [item.strip() for item in MAILBOX_SETTING.split(",") if item.strip()]
    custom, inbox, sent, everything = [], [], [], []
    for raw in checked(client.list()):
        if not isinstance(raw, bytes) or b"\\Noselect" in raw:
            continue
        match = re.search(rb'("(?:[^"\\]|\\.)*"|[^ ]+)$', raw)
        if not match:
            continue
        name = match.group(1).strip(b'"').decode("ascii", "replace")
        flags = raw.split(b")")[0].lower()
        if MAILBOX_SETTING == "AUTO" and any(flag in flags for flag in (b"\\trash", b"\\junk", b"\\drafts", b"\\flagged", b"\\important")):
            continue
        if name.upper() == "INBOX":
            inbox.append(name)
        elif b"\\all" in flags:
            everything.append(name)
        elif b"\\sent" in flags:
            sent.append(name)
        else:
            custom.append(name)
    # Primero las carpetas con nombre propio: su nombre dice de qué servicio es cada correo.
    return custom + (inbox or ["INBOX"]) + sent + everything


def load_pending(pending_path: Path, database) -> list:
    """Lista de adjuntos. Si el archivo está dañado, se reconstruye desde la base y se sigue."""
    try:
        pending = json.loads(pending_path.read_text("utf-8")) if pending_path.exists() else []
        if isinstance(pending, list):
            return pending
    except (ValueError, OSError):
        pass
    record_error("pending_rebuilt")
    try:
        os.replace(pending_path, pending_path.with_name(f"pending.dañado-{datetime.now():%Y%m%d-%H%M%S}.json"))
    except OSError:
        pass
    rebuilt = []
    for message_id, filename, content_type, size, digest, subject, sender, date_header, received in database.execute(
            "SELECT a.message_id, a.filename, a.content_type, a.size, a.sha256, m.subject, m.sender, m.date_header, m.received_at "
            "FROM attachments a JOIN messages m ON m.message_id = a.message_id ORDER BY m.received_at DESC"):
        rebuilt.append({"id": digest[:16], "sha256": digest, "messageId": message_id, "filename": filename, "contentType": content_type,
                        "bytes": size, "services": [], "source": "GMAIL_IMAP", "receivedAt": received, "date": str(date_header or "")[:200],
                        "from": str(sender or "")[:300], "subject": str(subject or "")[:300], "status": "A_CONFIRMAR"})
    atomic_json(pending_path, rebuilt)
    return rebuilt


def sync(factory=imaplib.IMAP4_SSL) -> dict:
    stats = {"status": "running", "mailboxes": 0, "known_uids": 0, "new_messages": 0,
             "relevant_messages": 0, "new_attachments": 0, "duplicates": 0, "errors": 0}
    if not ACCOUNT or not PASSWORD:
        return {**stats, "status": "blocked", "errors": 1, "error": "missing_server_credential"}
    client = None
    database = None
    pending_path = DATA_ROOT / "pending.json"
    try:
        client = factory("imap.gmail.com", 993, timeout=45)
        checked(client.login(ACCOUNT, PASSWORD))
        database = sqlite3.connect(DATA_ROOT / "messages.sqlite3", timeout=30)
        database.executescript(SCHEMA)
        migrate(database)
        attachment_dir = DATA_ROOT / "attachments"
        attachment_dir.mkdir(parents=True, exist_ok=True)
        pending = load_pending(pending_path, database)
        pending_hashes = {item.get("sha256") for item in pending}
        for mailbox in selected_mailboxes(client):
            try:
                checked(client.select(f'"{mailbox.replace(chr(34), "")}"', readonly=True))
                validity_data = client.response("UIDVALIDITY")[1]
                validity = validity_data[0].decode("ascii") if validity_data and validity_data[0] else ""
                if not validity.isdigit():
                    raise RuntimeError("missing_uidvalidity")
                known = {row[0] for row in database.execute(
                    "SELECT uid FROM processed_uids WHERE account=? AND mailbox=? AND uidvalidity=?",
                    (ACCOUNT, mailbox, validity))}
                uids = [int(value) for value in (checked(client.uid("search", None, "ALL"))[0] or b"").split()]
                stats["mailboxes"] += 1
                for uid in uids:
                    if uid in known:
                        stats["known_uids"] += 1
                        continue
                    try:
                        header_bytes = fetch_bytes(client, uid, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID SUBJECT FROM DATE)])")
                        header = BytesParser(policy=policy.default).parsebytes(header_bytes, headersonly=True)
                        message_id = str(header.get("Message-ID", "")).strip() or f"imap:{mailbox}:{validity}:{uid}"
                        if database.execute("SELECT 1 FROM messages WHERE message_id=?", (message_id,)).fetchone():
                            with database:
                                database.execute("INSERT INTO processed_uids VALUES (?,?,?,?,?,1)", (ACCOUNT, mailbox, validity, uid, message_id))
                                database.execute("INSERT OR IGNORE INTO labels VALUES (?,?)", (message_id, decode_mailbox(mailbox)))
                            stats["duplicates"] += 1
                            continue
                        blob = fetch_bytes(client, uid, "(BODY.PEEK[])")
                        message = BytesParser(policy=policy.default).parsebytes(blob)
                        files = message_files(message)
                        body = text_body(message)
                        relevant, services = is_relevant(str(message.get("Subject", "")), body, [name for name, _, _ in files])
                        with database:
                            database.execute("INSERT INTO processed_uids VALUES (?,?,?,?,?,?)", (ACCOUNT, mailbox, validity, uid, message_id, int(relevant)))
                            if relevant:
                                database.execute("INSERT INTO messages VALUES (?,?,?,?,?,?)", (message_id, mailbox, message.get("Subject"), message.get("From"), message.get("Date"), now()))
                                database.execute("INSERT OR REPLACE INTO bodies VALUES (?,?)", (message_id, body[:50_000]))
                                database.execute("INSERT OR IGNORE INTO labels VALUES (?,?)", (message_id, decode_mailbox(mailbox)))
                                for filename, content_type, content in files:
                                    digest = hashlib.sha256(content).hexdigest()
                                    destination = attachment_dir / (digest + safe_suffix(filename))
                                    if not destination.exists():
                                        temporary = destination.with_name(destination.name + ".part")
                                        temporary.write_bytes(content)
                                        os.replace(temporary, destination)
                                        stats["new_attachments"] += 1
                                    database.execute("INSERT OR IGNORE INTO attachments VALUES (?,?,?,?,?,?)", (message_id, filename, content_type, len(content), digest, str(destination)))
                                    if digest not in pending_hashes:
                                        pending.insert(0, {"mailbox": decode_mailbox(mailbox), "id": digest[:16], "sha256": digest, "messageId": message_id, "filename": filename, "contentType": content_type, "bytes": len(content), "services": services, "source": "GMAIL_IMAP", "receivedAt": now(), "date": str(message.get("Date", ""))[:200], "from": str(message.get("From", ""))[:300], "subject": str(message.get("Subject", ""))[:300], "status": "A_CONFIRMAR"})
                                        pending_hashes.add(digest)
                                stats["relevant_messages"] += 1
                            else:
                                database.execute("INSERT OR REPLACE INTO skipped VALUES (?,?,?,?,?,?,?)", (message_id, mailbox, str(message.get("Subject", ""))[:300], str(message.get("From", ""))[:300], str(message.get("Date", ""))[:200], "sin_adjunto_ni_mencion_de_guardia", now()))
                        stats["new_messages"] += 1
                    except Exception as exc:
                        stats["errors"] += 1
                        record_error("message_processing_failed", exc)
            except Exception as exc:
                stats["errors"] += 1
                record_error("mailbox_processing_failed", exc)
        if stats["new_messages"]:
            atomic_json(pending_path, pending[:2_000])
        stats["status"] = "partial" if stats["errors"] else "complete"
    except Exception as exc:
        stats["status"] = "failed"
        stats["errors"] += 1
        record_error("sync_failed", exc)
    finally:
        if client is not None:
            try:
                client.logout()  # Nunca CLOSE, STORE, COPY, MOVE ni EXPUNGE.
            except Exception as exc:
                record_error("logout_failed", exc)
        if database is not None:
            database.close()
    return stats


def main() -> int:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        with exclusive_run():
            stats = sync()
    except Exception as exc:
        record_error("concurrent_or_setup_failure", exc)
        stats = {"status": "failed", "errors": 1, "error": "concurrent_or_setup_failure"}
    # Leer lo descargado y publicar los cronogramas. Corre siempre, aunque el
    # correo no haya respondido, para que lo ya descargado quede disponible.
    try:
        import ingest_pending
        stats["catalog"] = ingest_pending.run()
    except Exception as exc:
        record_error("catalog_ingest_failed", exc)
    # Reclamo de planillas que faltan. Sólo envía si está habilitado en server/reclamos-config.json.
    try:
        import reclamos
        stats["reclamos"] = reclamos.run()
    except Exception as exc:
        record_error("reclamos_failed", exc)
    stats.update({"at": now(), "account": ACCOUNT, "readonly": True})
    atomic_json(DATA_ROOT / "status.json", stats)
    print(json.dumps(stats, ensure_ascii=False))
    return 0 if stats["status"] == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
