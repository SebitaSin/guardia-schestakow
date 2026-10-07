import { createFileRoute, redirect } from "@tanstack/react-router";

// Pacientes, camas y servicios son ahora una sola pantalla.
export const Route = createFileRoute("/internados/pacientes")({
  beforeLoad: () => { throw redirect({ to: "/internados/camas" }); },
});
