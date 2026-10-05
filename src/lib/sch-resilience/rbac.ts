import cfg from "@/data/sch-resilience/config.json";
import type { Role } from "./types";

export const ROLES: { id: Role; label: string }[] = [
  { id: "VIEWER", label: "Consulta" },
  { id: "STAFF", label: "Plantel" },
  { id: "DRIVER", label: "Conductor" },
  { id: "COORDINATOR", label: "Coordinación" },
  { id: "DIRECTION", label: "Dirección" },
  { id: "ADMIN", label: "Admin técnico" },
];

export function canApprove(role: Role) {
  return (cfg.roles_that_approve as string[]).includes(role) || role === "ADMIN";
}

export function canMarkAccess(role: Role) {
  return (cfg.roles_that_mark_access as string[]).includes(role) || role === "ADMIN";
}

export function canMarkStaff(role: Role) {
  return (cfg.roles_that_mark_staff as string[]).includes(role) || role === "ADMIN";
}

export function canActivateEmergency(role: Role) {
  return role === "DIRECTION" || role === "ADMIN";
}

export function canEditMinima(role: Role) {
  return role === "DIRECTION" || role === "ADMIN";
}

export function driverView(routeDriverId: string | null, role: Role, staffId: string | null) {
  if (role === "DRIVER") return { onlyOwn: true, driverId: staffId };
  return { onlyOwn: false, driverId: routeDriverId };
}
