# Reglas de trabajo

Leer antes de tocar nada: `OBJETIVO.md` y `ESTADO.md`.

## Una sola herramienta

- **Esta carpeta la modifica una sola herramienta: Claude.** Decisión de Sebastián del 5/10/2026: trabajar con dos a la vez generaba versiones cruzadas e instrucciones contradictorias.
- ChatGPT u otra herramienta puede usarse para consultar o comparar ideas, pero no edita archivos de esta carpeta, no hace `git` acá y sus propuestas no cambian `OBJETIVO.md`.
- Si alguna vez se suma otra herramienta, primero se escribe acá qué archivos toca cada una.

## Una sola versión

- **La fuente es la carpeta de la PC del hospital** (`schestakow-libre`). Ahí corre la app.
- **El repositorio de GitHub es su espejo.** Se actualiza desde esa carpeta. No se edita código directo en GitHub ni se suben zips.
- Un cambio existe cuando está en la carpeta, probado, y anotado en el registro de `ESTADO.md`.

## Qué nunca se sube

Credenciales, claves, sesiones (`server/session.secret`, `server/*.clixml`, `server/users.local.json`, `.env`), la carpeta `var/`, y los datos reales de pacientes y personal (`src/data/catalog.json`, `internacion.json`, `lab-pacientes.json`, `legajos.json`, `staff.json`, `inbox.json`, `mail-sync.json`). El `.gitignore` ya los excluye: no forzar su inclusión.

Por eso el repositorio tiene el código completo pero no arranca solo: los datos y las claves viven únicamente en la PC del hospital.

## Cómo se hace un cambio

1. Decir a qué punto de `OBJETIVO.md` responde y verificar que el punto del que depende ya anda. Si no, no se hace.
2. Leer `ESTADO.md` y su registro de cambios.
3. Guardar copia del archivo original en `_backups/<fecha>-<tema>/` antes de modificarlo.
4. Cambiar lo mínimo necesario. Nunca reescribir entero `server/app.mjs`, `server/start.mjs`, `scripts/start-secure.ps1` ni `package.json`.
5. Probar. Las pruebas internas pueden usar datos ficticios; lo que se le muestra al usuario, nunca.
6. Actualizar `ESTADO.md` separando **comprobado en la PC real**, **probado fuera de la PC**, **sin probar**, y agregar una línea al registro: fecha, archivos tocados, qué se probó, si hace falta reiniciar.
7. Si el cambio toca el servidor o las pantallas, hace falta reiniciar (`REINICIAR-SERVIDOR.cmd`); decirlo.
8. No se borra nada sin pedirlo. Lo que sobra se anota y lo decide Sebastián.

## Decisiones que son sólo de Sebastián

- Enviar imágenes o datos de pacientes a un servicio externo.
- Activar cualquier consumo pago.
- Eliminar la cuenta de WhatsApp del 260 405 6998 o registrar el número en Meta.
- Proveedor, dominio y publicación con datos reales.
- Enviar un mensaje real a personal del hospital.

## Comandos de verificación

```
npm run typecheck
npm test
python -m unittest discover -s scripts -p "test_*.py"
npm run build
```

## Honestidad

No escribir "completado" ni "funciona" sin haberlo visto funcionar con datos reales. Que exista el botón, compile o diga "API activa" no es prueba. Decir qué se probó, cómo, y qué limitación queda.
