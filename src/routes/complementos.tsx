import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, Camera, FolderSearch, LayoutDashboard, Mail, MessageCircle } from "lucide-react";

export const Route = createFileRoute("/complementos")({ component: ComplementosPage });

// Lo que se usa de vez en cuando, junto en un solo lugar para que el menú quede corto.
const ITEMS = [
  { to: "/internados/captura", icon: Camera, name: "Fotos de pizarras", text: "Las fotos que llegan por WhatsApp, cómo se leyeron y en qué servicio se publicaron." },
  { to: "/archivo", icon: FolderSearch, name: "Archivo del correo", text: "Todos los archivos recibidos en la casilla del hospital, por mes, con su destino." },
  { to: "/cambios", icon: Mail, name: "Cambios de guardia", text: "Cargar a mano un cambio entre dos personas y ver los hechos." },
  { to: "/internados/alertas", icon: Bell, name: "Alertas", text: "Ocupación alta, pacientes en ARM y camas a confirmar." },
  { to: "/internados", icon: LayoutDashboard, name: "Resumen del hospital", text: "Ocupación por servicio y días de internación en una sola vista." },
  { to: "/comunicaciones", icon: MessageCircle, name: "Mensajes al personal", text: "Todavía no envía: falta registrar el número en Meta." },
] as const;

function ComplementosPage() {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {ITEMS.map((item) => (
        <li key={item.to}>
          <Link to={item.to} className="flex min-h-24 items-start gap-3 rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><item.icon className="size-5" strokeWidth={1.75} /></span>
            <span>
              <span className="block font-semibold">{item.name}</span>
              <span className="mt-0.5 block text-sm text-muted">{item.text}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
