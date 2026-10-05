import { HospitalShell } from "@/components/hospital-shell";
import type { ReactNode } from "react";

export function Shell({ children }: { children: ReactNode }) {
  return <HospitalShell>{children}</HospitalShell>;
}
