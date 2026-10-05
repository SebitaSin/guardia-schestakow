import { Clock3 } from "lucide-react";
import { liveSyncHours } from "@/data/catalog";

export function SyncHours() {
  const hours = liveSyncHours();
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-primary"><Clock3 className="size-3.5" strokeWidth={1.75} />Revisión {hours.join(" y ")}</span>;
}
