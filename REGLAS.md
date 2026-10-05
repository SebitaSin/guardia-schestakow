# Reglas de trabajo (ChatGPT, Claude y cualquier otra herramienta)

Leer antes de tocar nada: `OBJETIVO.md` y `ESTADO.md`.

## Una sola versión

- **La fuente es la carpeta de la PC del hospital** (`schestakow-libre`). Ahí corre la app.
- **Este repositorio es su espejo.** Se actualiza desde esa carpeta. No se edita código directo en GitHub ni se suben zips: así nacieron las versiones cruzadas.
- Un cambio existe cuando está en la carpeta, probado, y reflejado acá con `ESTADO.md` actualizado.

## Qué nunca se sube

Credenciales, claves, sesiones (`server/session.secret`, `server/*.clixml`, `server/users.local.json`, `.env`), la carpeta `var/`, y los datos reales de pacientes y personal (`src/data/catalog.json`, `internacion.json`, `lab-pacientes.json`, `legajos.json`, `staff.json`, `inbox.json`, `mail-sync.json`). El `.gitignore` ya los excluye: no forzar su inclusión.

Por eso el repositorio tiene el código completo pero no arranca solo: los datos y las claves viven únicamente en la PC del hospital.

## Cómo se hace un cambio

1. Decir a qué punto de `OBJETIVO.md` responde. Si no responde a ninguno, no se hace.
2. Leer `ESTADO.md` para no pisar el trabajo del otro.
3. Guardar copia del archivo original en `_backups/<fecha>-<tema>/` antes de modificarlo.
4. Cambiar lo mínimo necesario.
5. Probar. Las pruebas internas pueden usar datos ficticios; lo que se le muestra al usuario, nunca.
6. Actualizar `ESTADO.md` separando: **comprobado en la PC real**, **probado fuera de la PC**, **sin probar**.
7. Si el cambio toca el servidor o las pantallas, hace falta reiniciar (`REINICIAR-SERVIDOR.cmd`); decirlo.

## Comandos de verificación

```
npm run typecheck
npm test
python -m unittest discover -s scripts -p "test_*.py"
npm run build
```

## Honestidad

No escribir "completado" ni "funciona" sin haberlo visto funcionar con datos reales. Decir qué se probó, cómo, y qué limitación queda.
