# Objetivo

App del Hospital Teodoro J. Schestakow (San Rafael, Mendoza). Centraliza la información operativa del hospital y ayuda a sostener su funcionamiento diario y ante catástrofes o emergencias. La usan Dirección, Coordinación y los jefes de servicio. Un dato equivocado o faltante puede costar una vida: por eso el orden de esta lista manda sobre cualquier otra idea.

## Qué tiene que hacer, en orden

1. **Saber quién está de guardia hoy en cada servicio, sin un segundo de duda.**
2. **Que eso salga solo del correo.** Cada planilla o cambio de guardia que llega a la casilla del hospital se baja, se reconoce, se lee y se refleja en pantalla sin que nadie haga nada. Ningún mail se descarta.
3. **Pacientes y camas por servicio.** Las fotos de pizarras que llegan por WhatsApp actualizan la planilla de cada servicio y se contrastan con laboratorio. Lo dudoso queda en amarillo, editable, con botón Confirmar.
4. **Nómina única por servicio.** Nombre, función, servicio, teléfono, domicilio y modalidad de traslado. Una fila por persona real aunque trabaje en varios servicios. Mapa, abecedario y áreas unificadas.
5. **Comunicación con el personal por WhatsApp.** Enviar avisos, recibir respuestas, saber quién está disponible, quién puede llegar y quién necesita transporte.
6. **Cobertura.** Por servicio: quién debería estar, quién confirmó y quién está presente. Faltantes según la dotación que defina el hospital; si no está definida, "sin determinar".
7. **Catástrofes.** Modo de contingencia (cobertura, personal disponible / sin respuesta / imposibilitado, quién necesita transporte, vehículos, accesos y cortes con fuente y hora) y propuesta de recorridos de traslado que se revisa y confirma antes de comunicarse.
8. **Funcionar por internet.** Desde cualquier dispositivo con un enlace, en un servidor independiente de la PC, con un usuario al inicio y posibilidad de sumar otros. Los datos y pendientes se conservan al reiniciar.
9. **Todo simple.** Sin pestañas, textos ni botones que no sirvan. Si algo no funciona o no tiene datos, se saca.

## Orden de trabajo

No se empieza un punto si aquel del que depende no anda con datos reales.

- 1 y 2 van primero y se terminan (falta: cambios escritos en el texto del mail, fotos de planillas, guardias de cirugía y pediatría).
- 3 depende de que las fotos entren solas y de laboratorio con datos actuales.
- 5 depende de 4 (teléfonos) y de la cuenta de Meta.
- 6 depende de 1 y de 5.
- 7 depende de 4, 5 y 6. Hasta entonces no se construyen pantallas de catástrofe vacías.
- 8 se puede preparar en paralelo; se publica cuando 1 y 2 están comprobados tras reiniciar y existe respaldo de `var/` y de la clave fuera de la PC.

## Reglas del producto

- **Nunca mostrar un dato inventado.** Si una planilla no se pudo leer con certeza, ese servicio queda en blanco (con los lugares que tenía la guardia anterior), no con un nombre supuesto.
- **Nunca mostrar datos simulados.** En pantalla y en los informes, sólo datos reales.
- **Cada dato dice su estado:** actualizado (con fecha y hora), confirmado, o pendiente de revisión. Lo desconocido se muestra como desconocido.
- **Estados que no se mezclan:**
  - Debería estar de guardia ≠ confirmó que va ≠ está presente.
  - Mensaje pendiente ≠ enviado ≠ entregado ≠ respondido. "Entregado" no es confirmación; falta de respuesta no es ausencia.
  - Domicilio registrado ≠ ubicación actual. Un punto de encuentro se acuerda, no se supone.
  - Coincidencia aproximada con laboratorio = sugerencia; no prueba identidad ni ubicación.
- **Pizarras:** una foto corresponde a un servicio. La última válida define la planilla y se conserva el historial. Una foto vieja reenviada no reemplaza a una nueva. Si está cortada, no se quitan pacientes por lo que no se ve. Una confirmación de cama no se hereda al siguiente paciente de esa cama. M/T/N en letra chica y azul según el grupo o turno de origen; si el origen no se conoce, el turno figura como estimado y en amarillo.
- **Resolver solo, sin avisos**, cuando hay certeza: la app compara con cronogramas anteriores, con la nómina y con el remitente. Cuando no hay certeza, amarillo y Confirmar.
- **Barato.** Reglas y comparaciones normales para todo lo que se pueda (Word, Excel, PDF con texto). No hay presupuesto de IA: no se activa ningún consumo pago sin acordarlo, ni se reprocesa una imagen idéntica.
- **IA y datos de pacientes:** ninguna imagen con datos de pacientes sale a un servicio externo sin autorización expresa de Sebastián. Dada el 5/10/2026 por chat para un solo uso: leer las fotos de pizarras con OpenAI, con tope mensual (`server/ai-config.json`). Dada el 6/10/2026 por chat para un segundo uso: leer con OpenAI las fotos de planillas de guardias que llegan por correo (nombres de personal, no de pacientes), con el mismo tope mensual. Cualquier otro envío sigue sin autorizar.
- **Vigencia:** prioridad a los documentos de octubre. Nada de más de dos semanas entra como información vigente.
- **Distinciones de servicios:** la Guardia tiene clínica, cirugía y pediatría propias, distintas de los servicios de Clínica Médica, Cirugía y Pediatría. Cirugía Pediátrica es otro servicio. UTI, UTIA y Terapia Intensiva Adultos son la misma área.

## Qué no es objetivo

Todo lo que no acerque a los nueve puntos. Antes de empezar una tarea, decir a cuál responde.
