import { createFileRoute } from "@tanstack/react-router";
import { ClimaPanel } from "@/components/clima-panel";

// Pantalla principal de Contingencia: clima y alertas. El tablero anterior ("Ahora") pasó a /continuidad/ahora.
export const Route = createFileRoute("/continuidad/")({ component: ClimaPanel });
