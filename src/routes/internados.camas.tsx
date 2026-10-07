import { createFileRoute } from "@tanstack/react-router";
import { ServiciosUnificados } from "@/components/servicios-unificados";

export const Route = createFileRoute("/internados/camas")({ component: () => <ServiciosUnificados /> });
