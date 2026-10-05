# Plantillas para enviar a aprobación de Meta

Meta tarda entre minutos y 48 h en aprobar. Mandalas apenas tengas la WABA, así no son
el cuello de botella después.

**Por qué hacen falta:** fuera de la ventana de 24 h sólo se pueden mandar plantillas
aprobadas, no texto libre. Un aviso de guardia casi siempre cae fuera de ventana, porque
la persona no te escribió en el último día. Sin plantilla aprobada, no hay aviso.

**Dónde se cargan:** WhatsApp Manager → Herramientas de la cuenta → Plantillas de mensajes
→ Crear plantilla.

**Categoría:** todas `UTILITY` (Utilidad). No pongas `MARKETING`: es más caro y exige
opt-in explícito. Si Meta te reclasifica alguna a MARKETING, es porque el texto suena
promocional — sacá cualquier cosa que parezca invitación o difusión.

**Idioma:** `es_AR`. Tiene que coincidir exactamente con el `languageCode` del módulo
(que por defecto manda `es_AR`).

---

## 1. `aviso_guardia`

Asignación o cambio de guardia.

**Categoría:** UTILITY · **Idioma:** es_AR

**Cuerpo:**

```
Hola {{1}}. Se registró un cambio en tu guardia del {{2}} en {{3}}. Nuevo horario: {{4}}. Si no podés cubrirla, avisá respondiendo a este mensaje.
```

**Ejemplos para el formulario de Meta:**

| Variable | Ejemplo |
|---|---|
| {{1}} | Sebastián |
| {{2}} | jueves 2 de octubre |
| {{3}} | UCCyQ |
| {{4}} | 20:00 a 08:00 |

**Llamada desde el módulo:**

```json
{
  "to": "2604056998",
  "kind": "template",
  "templateName": "aviso_guardia",
  "params": ["Sebastián", "jueves 2 de octubre", "UCCyQ", "20:00 a 08:00"],
  "motivo": "cambio de guardia UCCyQ"
}
```

---

## 2. `cobertura_urgente`

Pedido de cobertura por ausencia.

**Categoría:** UTILITY · **Idioma:** es_AR

**Cuerpo:**

```
Hola {{1}}. Necesitamos cubrir una guardia en {{2}} el {{3}} de {{4}}. Si podés tomarla, respondé SI a este mensaje. Si no, no hace falta que respondas.
```

| Variable | Ejemplo |
|---|---|
| {{1}} | Sebastián |
| {{2}} | Pediatría |
| {{3}} | sábado 4 de octubre |
| {{4}} | 08:00 a 20:00 |

Cuando la persona responde, se abre la ventana de 24 h y a partir de ahí podés contestarle
con texto libre por `/api/whatsapp/outbox` con `kind: "text"`. El módulo verifica la
ventana solo.

---

## 3. `pedido_transporte`

Coordinación de traslado de personal.

**Categoría:** UTILITY · **Idioma:** es_AR

**Cuerpo:**

```
Hola {{1}}. Se coordinó tu traslado al hospital para la guardia del {{2}}. Pasan a buscarte por {{3}} a las {{4}}. Confirmá respondiendo a este mensaje.
```

| Variable | Ejemplo |
|---|---|
| {{1}} | Sebastián |
| {{2}} | jueves 2 de octubre |
| {{3}} | Av. Mitre y Chile |
| {{4}} | 19:15 |

Usá el punto de referencia público, no el domicilio exacto — es lo que ya hace
`private-locations.mjs`.

---

## Reglas que hacen que Meta rechace una plantilla

- El cuerpo **no puede empezar ni terminar** con una variable.
- **No puede haber dos variables pegadas** (`{{1}} {{2}}` está bien, `{{1}}{{2}}` no).
- Las variables van numeradas **sin saltos**: `{{1}}`, `{{2}}`, `{{3}}`.
- El valor de una variable **no puede tener saltos de línea, tabs ni espacios dobles**.
  El módulo ya rechaza eso antes de llamar a Meta (`invalid_template_params`).
- El nombre de la plantilla va en **minúsculas y guión bajo**, nada más.
- Los ejemplos que cargues tienen que ser **realistas**. Ejemplos tipo "xxx" o "prueba"
  son motivo de rechazo.

## Sobre datos de pacientes

Ninguna de estas tres lleva nombre, diagnóstico ni dato clínico, y conviene que siga así.
Una plantilla con datos de paciente pasa por los servidores de Meta y queda fuera del
esquema de cifrado en reposo que ya tenés en el resto de la app. Si en algún momento hace
falta mandar algo clínico, que sea un aviso genérico con un link a la app, y el dato se ve
adentro del sistema con sesión iniciada.

## Después de aprobadas

```bash
# Listar plantillas y ver su estado
curl "https://graph.facebook.com/v23.0/<WABA_ID>/message_templates?fields=name,status,category,language" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN"
```

`status` tiene que decir `APPROVED`. Si dice `REJECTED`, el campo `rejected_reason`
te dice por qué.
