#!/usr/bin/env python3
"""Login Nextlab (Biolatina) and dump internación patients. Server-only."""
from __future__ import annotations

import os
import json
import re
import time
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from datetime import date, timedelta

ROOT = Path(os.environ.get("APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
DATA_DIR = Path(os.environ.get("APP_DATA_DIR", ROOT / "var")).resolve()
OUT = DATA_DIR / "lab" / "pacientes.json"

def config():
    url = os.environ.get("LAB_BASE_URL", "").rstrip("/")
    login = os.environ.get("LAB_LOGIN", "")
    password = os.environ.get("LAB_PASSWORD", "")
    if not url or not login or not password:
        raise RuntimeError("missing_lab_credentials")
    return {"url": url, "login": login, "password": password}

UA = "Mozilla/5.0 (compatible; GuardiaSchestakow/1.0)"


def opener():
    jar = CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def post(op, url, data: dict) -> str:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"})
    with op.open(req, timeout=30) as r:
        return r.read().decode("latin-1", errors="replace")


def parse_rows(html: str) -> list[dict]:
    rows = []
    for block in re.finditer(r'class="trresult">([\s\S]*?)</tr>', html, re.I):
        tds = re.findall(r"<td[^>]*>\s*([\s\S]*?)\s*</td>", block.group(1), re.I)
        clean = [re.sub(r"<[^>]+>", " ", x) for x in tds]
        clean = [" ".join(x.split()) for x in clean]
        if len(clean) < 6:
            continue
        doc = clean[2]
        dni = re.sub(r"\D", "", doc)
        rows.append(
            {
                "orden": clean[0],
                "fecha": clean[1],
                "documento": doc,
                "dni": dni or None,
                "nombre": clean[3].replace(" ,", ",").strip(),
                "origen": clean[4],
                "servicio": clean[5],
            }
        )
    return rows


def pages(html: str) -> int:
    m = re.search(r'cantidadPag" value="(\d+)"', html)
    return int(m.group(1)) if m else 1


def fetch(desde=None, hasta=None) -> list[dict]:
    today = date.today()
    desde = desde or (today - timedelta(days=7)).strftime("%d/%m/%Y")
    hasta = hasta or today.strftime("%d/%m/%Y")
    secret = config()
    op = opener()
    post(op, f"{secret['url']}/default.asp?Action=Login", {"login": secret["login"], "password": secret["password"]})
    payload = {
        "sts": "search",
        "nro_ord": "",
        "apellido": "",
        "tipodoc": "DNI",
        "nrodoc": "",
        "fdesde": desde,
        "fhasta": hasta,
        "sServicios": "Todos",
        "estado": "Todos",
        "servicioSel": "Todos",
        "cod_ser": "A",
        "DatosInt": "N",
        "Filtro": "0",
    }
    first = post(op, f"{secret['url']}/areas/servicio/labListapac.asp?Action=search&pag=1", payload)
    n = pages(first)
    all_rows = parse_rows(first)
    for p in range(2, n + 1):
        html = post(op, f"{secret['url']}/areas/servicio/labListapac.asp?Action=search&pag={p}", payload)
        all_rows.extend(parse_rows(html))
        if p % 25 == 0:
            print(f"pag {p}/{n} rows {len(all_rows)}", flush=True)
        time.sleep(0.05)
    # unique by dni+nombre
    seen = set()
    uniq = []
    for r in all_rows:
        k = (r.get("dni"), r["nombre"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"desde": desde, "hasta": hasta, "total": len(uniq), "pacientes": uniq}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("saved", len(uniq), "of", len(all_rows), "pages", n)
    return uniq


if __name__ == "__main__":
    fetch()
