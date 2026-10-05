"""
buscar_pacientes.py
===================
Lista pacientes del LABORATORIO Schestakow (https://schestakow.biolatinasrl.com).

Entra solo (sin navegador), busca y te muestra los pacientes con su nombre.
NO descarga PDFs ni abre estudios: solo lee la lista, como scrolear el buscador.

Sirve para:
  - Ver la lista de pacientes de TODOS los servicios (no solo UTI/UCCYQ).
  - Verificar si un nombre esta bien escrito.
  - Copiar los datos (exporta a CSV para pegar en Excel / documento).

USO (doble clic en BUSCAR.bat, o desde consola):
  python buscar_pacientes.py                    -> ultimos 7 dias, todos
  python buscar_pacientes.py --dias 30          -> ultimos 30 dias
  python buscar_pacientes.py --dni 12345678     -> un paciente por DNI
  python buscar_pacientes.py --apellido PEREZ   -> por apellido
  python buscar_pacientes.py --csv salida.csv   -> ademas guarda un CSV

CREDENCIALES (usuario y clave del laboratorio):
  1) Si existe un archivo .env al lado de este script, las lee de ahi.
  2) Si no, prueba el .env de agente_uti (la instalacion de TEO).
  3) Si tampoco, las pide por teclado al iniciar.
"""
import os
import sys
import csv
import argparse
import getpass
from datetime import datetime, timedelta
from pathlib import Path

try:
    import httpx
    from bs4 import BeautifulSoup
except ImportError:
    print("Faltan librerias. Ejecuta una vez:  pip install httpx beautifulsoup4")
    sys.exit(1)

# URL del LABORATORIO (no es rayos; rayos es otro sistema aparte)
BASE = "https://schestakow.biolatinasrl.com"

AQUI = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("APP_ROOT", AQUI.parent)).resolve()


# ── Credenciales ────────────────────────────────────────────────────────────
def _cargar_env(ruta: Path):
    if not ruta.exists():
        return
    for line in ruta.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def obtener_credenciales():
    # 1) .env local (al lado del script)
    _cargar_env(AQUI / ".env")
    # 2) entorno privado del servidor (nunca se incluye en el cliente)
    _cargar_env(ROOT / ".env")

    user = os.environ.get("LAB_LOGIN") or os.environ.get("BIOBOX_USER", "")
    pw = os.environ.get("LAB_PASSWORD") or os.environ.get("BIOBOX_PASS", "")

    # 3) Pedir por teclado si falta
    if not user:
        user = input("Usuario del laboratorio: ").strip()
    if not pw:
        pw = getpass.getpass("Contrasena: ").strip()
    return user, pw


# ── Formulario de busqueda ──────────────────────────────────────────────────
def build_search_data(fdesde, fhasta, nrodoc="", apellido=""):
    """Campos del formulario. sServicios='Todos' = trae TODOS los servicios."""
    return {
        "sts": "go",
        "frm_no": "on", "frm_cp": "on", "frm_me": "on", "frm_st": "on",
        "frm_fe": "on", "frm_pd": "on",
        "nro_ord": "", "apellido": apellido,
        "tipodoc": "DNI" if nrodoc else "", "nrodoc": nrodoc, "ref_externa": "",
        "fdesde": fdesde, "fhasta": fhasta, "estado": "Todos",
        "sServicios": "Todos",
        "microbiologia": "", "sucursalSel": "", "origenSel": "",
        "estadoSel": "", "DatosInt": "N", "Filtro": "1",
        "cod_ser": "A", "servicioSel": "",
    }


def parse_lista(html):
    """De la tabla HTML saca (orden, fecha, paciente)."""
    soup = BeautifulSoup(html, "html.parser")
    filas = []
    for row in soup.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 5:
            continue
        orden = cells[0].get_text(strip=True)
        if not orden.isdigit():
            continue
        fecha = cells[1].get_text(strip=True)
        paciente = cells[3].get_text(" ", strip=True)
        filas.append((orden, fecha, paciente))
    return filas


def main():
    ap = argparse.ArgumentParser(description="Lista pacientes del laboratorio Schestakow.")
    ap.add_argument("--dias", type=int, default=7, help="Dias hacia atras (def 7)")
    ap.add_argument("--dni", default="", help="Buscar por DNI")
    ap.add_argument("--apellido", default="", help="Buscar por apellido")
    ap.add_argument("--csv", default="", help="Guardar resultado en un archivo CSV")
    args = ap.parse_args()

    user, pw = obtener_credenciales()
    if not user or not pw:
        print("ERROR: falta usuario o contrasena.")
        sys.exit(1)

    fhasta = datetime.now().strftime("%d/%m/%Y")
    fdesde = (datetime.now() - timedelta(days=args.dias)).strftime("%d/%m/%Y")

    with httpx.Client(base_url=BASE, verify=False, follow_redirects=True,
                      timeout=30.0,
                      headers={"User-Agent": "Mozilla/5.0", "Referer": BASE + "/"}) as c:
        # 1) Login
        c.get("/login.asp")
        r = c.post("/default.asp?Action=Login", data={"login": user, "password": pw})
        if "labListapac" not in str(r.url):
            print(f"ERROR: login fallo. Revisa usuario/clave. URL final: {r.url}")
            sys.exit(1)
        print(f"Login OK como {user}\n")

        # 2) Buscar (paginado de a 10)
        vistos = set()
        total = []
        for pag in range(1, 30):
            data = build_search_data(fdesde, fhasta, args.dni, args.apellido)
            r = c.post(f"/areas/servicio/labListapac.asp?Action=todas&pag={pag}", data=data)
            filas = parse_lista(r.text)
            nuevas = [f for f in filas if f[0] not in vistos]
            if not nuevas:
                break
            for f in nuevas:
                vistos.add(f[0])
            total.extend(nuevas)
            if len(filas) < 10:
                break

    # 3) Mostrar
    print(f"{len(total)} pacientes ({fdesde} a {fhasta}):\n")
    print(f"{'ORDEN':<10} {'FECHA':<12} PACIENTE")
    print("-" * 60)
    for orden, fecha, paciente in total:
        print(f"{orden:<10} {fecha:<12} {paciente}")

    # 4) CSV opcional
    if args.csv:
        ruta = Path(args.csv)
        with ruta.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["orden", "fecha", "paciente"])
            w.writerows(total)
        print(f"\nGuardado en: {ruta.resolve()}")


if __name__ == "__main__":
    main()
