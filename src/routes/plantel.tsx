import { createFileRoute } from "@tanstack/react-router";
import { PersonalMapPage } from "@/components/personal-map";

// Personal: mapa, abecedario y áreas unificadas.
export const Route = createFileRoute("/plantel")({ component: PersonalMapPage });
