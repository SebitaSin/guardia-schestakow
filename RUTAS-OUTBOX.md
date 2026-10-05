# Cómo enganchar el outbox en `server/app.mjs`

Tres bloques. No toqué el archivo: pegalos vos y corré `npm test`.

## 1. Import — debajo de la línea 6

Buscá:

```js
import { findWhatsAppMedia, receiveWhatsApp, whatsappInbox, whatsappReady } from "./whatsapp.mjs";
```

Agregá abajo:

```js
import { applyStatusUpdates, approveOutbound, deliverManual, deliverOutbound, manualBatchLinks, outboxSummary, queueOutbound, queueOutboundBatch, readOutbox, rejectOutbound, serviceWindowStatus } from "./whatsapp-send.mjs";
```

## 2. Acuses de entrega — dentro de `/api/whatsapp/webhook`, rama POST

Tu receptor lee `change.value.messages` e ignora `change.value.statuses`. Ahí llegan los acuses. Reemplazá:

```js
        if (req.method === "POST") {
          const raw = await readBody(req, 10 * 1024 * 1024);
          const result = await receiveWhatsApp({ raw, signature: req.headers["x-hub-signature-256"], dataDir, config: waConfig, fetchImpl });
          return send(res, result.status, result.body);
        }
```

por:

```js
        if (req.method === "POST") {
          const raw = await readBody(req, 10 * 1024 * 1024);
          const result = await receiveWhatsApp({ raw, signature: req.headers["x-hub-signature-256"], dataDir, config: waConfig, fetchImpl });
          // Un 200 ya implica firma válida y JSON parseable.
          // Nunca romper la respuesta al webhook: si esto tira, Meta reintenta y duplica el ingreso.
          if (result.status === 200) {
            try {
              applyStatusUpdates(dataDir, authConfig.secret, JSON.parse(raw.toString("utf8")));
            } catch (error) {
              appendAudit(dataDir, { actor: "system", role: "SYSTEM", action: "whatsapp_status_update_failed", kind: "system_error", detail: error instanceof Error ? error.message.slice(0, 120) : "status_error" });
            }
          }
          return send(res, result.status, result.body);
        }
```

## 3. Rutas — debajo de `/api/whatsapp/config`

Buscá:

```js
      if (url.pathname === "/api/whatsapp/config") return json(res, 405, { error: "server_environment_only" });
```

Pegá debajo:

```js
      // --- Etapa 6: mensajes salientes ---
      // Coordinación redacta, Dirección aprueba y envía. Nadie envía lo que redactó.
      if (url.pathname === "/api/whatsapp/outbox" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, { configured: whatsappReady(waConfig), resumen: outboxSummary(dataDir, authConfig.secret), mensajes: readOutbox(dataDir, authConfig.secret) });
      }
      if (url.pathname === "/api/whatsapp/window" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, serviceWindowStatus(dataDir, url.searchParams.get("phone") ?? ""));
      }
      if (url.pathname === "/api/whatsapp/outbox/links" && req.method === "GET") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        return json(res, 200, { links: manualBatchLinks(dataDir, authConfig.secret) });
      }
      if (url.pathname === "/api/whatsapp/outbox" && req.method === "POST") {
        if (!hasRole(user, ["COORDINATOR", "DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 256 * 1024)).toString("utf8"));
        try {
          const created = Array.isArray(body.to)
            ? queueOutboundBatch(dataDir, authConfig.secret, body.to, body, user.id)
            : [queueOutbound(dataDir, authConfig.secret, body, user.id)];
          appendAudit(dataDir, { actor: user.id, role: user.role, action: "queue_whatsapp_outbound", kind: "human_decision", count: created.length, motivo: created[0]?.motivo ?? "", ids: created.map((item) => item.id) });
          return json(res, 201, { creados: created });
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : "invalid_outbound" });
        }
      }
      if (url.pathname === "/api/whatsapp/outbox/approve" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 8 * 1024)).toString("utf8"));
        try {
          const record = approveOutbound(dataDir, authConfig.secret, String(body.id ?? ""), user.id);
          if (record.creado_por === user.id) {
            appendAudit(dataDir, { actor: user.id, role: user.role, action: "whatsapp_self_approved", kind: "human_decision", entity: record.id });
          }
          appendAudit(dataDir, { actor: user.id, role: user.role, action: "approve_whatsapp_outbound", kind: "human_decision", entity: record.id, destinatario: record.to });
          return json(res, 200, { mensaje: record });
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : "approve_failed" });
        }
      }
      if (url.pathname === "/api/whatsapp/outbox/reject" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 8 * 1024)).toString("utf8"));
        try {
          const record = rejectOutbound(dataDir, authConfig.secret, String(body.id ?? ""), user.id, String(body.reason ?? ""));
          appendAudit(dataDir, { actor: user.id, role: user.role, action: "reject_whatsapp_outbound", kind: "human_decision", entity: record.id });
          return json(res, 200, { mensaje: record });
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : "reject_failed" });
        }
      }
      // Canal manual: anda HOY, sin token ni plantillas.
      if (url.pathname === "/api/whatsapp/outbox/manual" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        const body = JSON.parse((await readBody(req, 8 * 1024)).toString("utf8"));
        try {
          const record = deliverManual(dataDir, authConfig.secret, String(body.id ?? ""), user.id);
          appendAudit(dataDir, { actor: user.id, role: user.role, action: "send_whatsapp_manual", kind: "human_decision", entity: record.id, destinatario: record.to });
          return json(res, 200, { mensaje: record });
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : "manual_failed" });
        }
      }
      // Canal API: requiere token.
      if (url.pathname === "/api/whatsapp/outbox/send" && req.method === "POST") {
        if (!hasRole(user, ["DIRECTION", "ADMIN"])) return json(res, 403, { error: "forbidden" });
        if (!whatsappReady(waConfig)) return json(res, 503, { error: "whatsapp_not_configured" });
        const body = JSON.parse((await readBody(req, 8 * 1024)).toString("utf8"));
        try {
          const record = await deliverOutbound({ dataDir, secret: authConfig.secret, id: String(body.id ?? ""), config: waConfig, fetchImpl });
          appendAudit(dataDir, { actor: user.id, role: user.role, action: "send_whatsapp_outbound", kind: "human_decision", entity: record.id, destinatario: record.to, wamid: record.wamid ?? "" });
          return json(res, 200, { mensaje: record });
        } catch (error) {
          const detail = error instanceof Error ? error.message : "send_failed";
          appendAudit(dataDir, { actor: user.id, role: user.role, action: "send_whatsapp_outbound_failed", kind: "system_error", entity: String(body.id ?? ""), detail: detail.slice(0, 120) });
          return json(res, 400, { error: detail });
        }
      }
```

## Prueba sin Meta

```bash
curl -X POST localhost:8788/api/whatsapp/outbox -b cookie.txt \
  -H 'content-type: application/json' \
  -d '{"to":"2604056998","kind":"text","body":"Prueba de aviso","motivo":"prueba"}'

curl -X POST localhost:8788/api/whatsapp/outbox/approve -b cookie.txt \
  -H 'content-type: application/json' -d '{"id":"<id>"}'

curl -X POST localhost:8788/api/whatsapp/outbox/manual -b cookie.txt \
  -H 'content-type: application/json' -d '{"id":"<id>"}'
```

La última devuelve el `link`. Se abre desde el teléfono del hospital y sale el mensaje.

## Cuando tengas el token

No cambia nada del circuito: la misma cola, la misma aprobación, la misma bitácora. Sólo se usa `/send` en vez de `/manual`, y aparecen los acuses de entrega. Para eso sí hacen falta las plantillas aprobadas, porque los avisos de guardia casi siempre caen fuera de la ventana de 24 h.
