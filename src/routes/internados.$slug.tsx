import { createFileRoute } from "@tanstack/react-router";
import { ServiciosUnificados } from "@/components/servicios-unificados";

export const Route = createFileRoute("/internados/$slug")({ component: ServicioPage });

function ServicioPage() {
  const { slug } = Route.useParams();
  return <ServiciosUnificados slug={slug} />;
}
