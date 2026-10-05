# Imagen única para cualquier proveedor que corra contenedores (servidor propio, Railway, Render, Fly...).
# Se construye desde la carpeta de la PC del hospital: necesita src/data/*.json, que no están en GitHub.
#   docker build -f deploy/Dockerfile -t guardia-schestakow .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM node:22-bookworm-slim
# Python lee el correo y las planillas (sólo biblioteca estándar + scripts/vendor).
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    APP_ROOT=/app \
    APP_HOST=0.0.0.0 \
    APP_DATA_DIR=/data \
    APP_COOKIE_SECURE=true \
    APP_TRUST_PROXY=true \
    TZ=America/Argentina/Mendoza \
    PYTHON_COMMAND=python3 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/data ./src/data

# /data es lo único que hay que conservar: correo, planillas leídas, contactos y mensajes cifrados.
VOLUME /data
EXPOSE 8788
HEALTHCHECK --interval=1m --timeout=10s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||process.env.PORT||8788)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/start.mjs"]
