import { createFileRoute } from "@tanstack/react-router";
import { ClimaPanel } from "@/components/clima-panel";

export const Route = createFileRoute("/continuidad/clima")({ component: ClimaPanel });
