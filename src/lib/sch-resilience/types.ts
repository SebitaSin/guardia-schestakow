export type SystemState = "NORMAL" | "WATCH" | "PREPARE" | "EMERGENCY" | "RECOVERY";
export type SourceType = "STATIC" | "SEMI_STATIC" | "DYNAMIC" | "HUMAN_CONFIRMED";
export type DatumStatus = "VALID" | "STALE" | "CONFLICT" | "UNKNOWN";
export type ClosureState = "OPEN" | "RESTRICTED" | "CLOSED" | "UNKNOWN";
export type TransportStatus =
  | "UNKNOWN"
  | "SELF"
  | "NEEDS_TRANSPORT"
  | "CAN_DRIVE"
  | "UNAVAILABLE"
  | "ARRIVED";
export type AvailabilityStatus =
  | "UNKNOWN"
  | "SCHEDULED_ONLY"
  | "CAN_COVER_SHIFT"
  | "CAN_SUPPORT_OTHER_SERVICE"
  | "UNAVAILABLE";
export type DisasterSupportStatus = "UNKNOWN" | "YES" | "NO";
export type Role = "ADMIN" | "DIRECTION" | "COORDINATOR" | "DRIVER" | "STAFF" | "VIEWER";
export type Health = "OK" | "DEGRADED" | "FAILED" | "STALE";
export type RouteStatus = "DRAFT" | "APPROVED" | "RECHECK_REQUIRED" | "SHADOW" | "INVALIDATED";

export type Provenance<T> = {
  value: T;
  source: string;
  source_type: SourceType;
  timestamp: string | null;
  retrieved_at: string;
  expires_at: string | null;
  confidence: number;
  status: DatumStatus;
};

export type WeatherWindow = {
  id: "NOW" | "0-2h" | "2-6h" | "6-12h" | "12-24h";
  precip_mm: number | null;
  intensity_mmh: number | null;
  hail: boolean | null;
  wind_kmh: number | null;
  visibility_m: number | null;
  storm_prob: number | null;
};

export type WeatherState = {
  windows: WeatherWindow[];
  warning_level: number | null;
  raw: { error?: string } | null;
  provenance: Provenance<"ok" | "failed">;
};

export type RiskBreakdown = {
  H: number;
  A: number;
  S: number;
  D: number;
  R: number;
  band: "BAJO" | "MEDIO" | "ALTO" | "CRITICO";
  model_version: string;
  explanation: string[];
  overrides: string[];
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  km: number;
  min: number;
  water_risk: number;
  closure_state: ClosureState;
  source?: string;
  last_verified?: string | null;
  confidence?: number;
};

export type GraphNode = {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
};

export type StaffOps = {
  staff_id: string;
  name: string;
  service: string;
  shift_date: string | null;
  criticality: number | null;
  operational_zone: string | null;
  preferred_pickup_point: string | null;
  transport_status: TransportStatus;
  vehicle_available: boolean | null;
  vehicle_capacity: number | null;
  can_transport_others: boolean | null;
  availability_timestamp: string | null;
  availability_status: AvailabilityStatus;
  support_service: string | null;
  disaster_support_status: DisasterSupportStatus;
  disaster_support_areas: string[];
  scheduled: boolean;
};

export type StaffImpact = {
  horizon: string;
  staff_required: number | null;
  staff_confirmed: number;
  staff_unknown: number;
  staff_at_risk: number;
  staff_needing_transport: number;
  coverage_available: number;
  support_available: number;
  disaster_support_available: number;
  critical_role_gaps: { service: string; gap: number | "UNKNOWN" }[];
  people: StaffOps[];
};

export type RouteStop = { node: string; staff_ids: string[]; eta_min: number };

export type TransportRoute = {
  route_id: string;
  driver: string;
  vehicle_capacity: number;
  occupancy: number;
  pickup_sequence: RouteStop[];
  safe_route: string[];
  estimated_departure: string | null;
  estimated_arrival: string | null;
  risk_summary: string;
  source_timestamp: string;
  unresolved_conditions: string[];
  status: RouteStatus;
};

export type HealthBoard = {
  weather: Health;
  road: Health;
  staff: Health;
  routing: Health;
  database: Health;
  automation: Health;
  last_success: string | null;
};

export type Snapshot = {
  checked_at: string;
  changed: boolean;
  system_state: SystemState;
  degraded: boolean;
  missing_sources: string[];
  risk: RiskBreakdown;
  weather: WeatherState;
  staff: StaffImpact;
  routes: TransportRoute[];
  closures: { edge_id: string; closure_state: ClosureState; source: string; updated_at: string }[];
  health: HealthBoard;
  hash: string;
  shadow_mode: boolean;
  model_version: string;
  geo_model_version: string;
  graph_version: string;
};

export type Transition = {
  timestamp: string;
  previous_state: SystemState;
  new_state: SystemState;
  reason: string;
  evidence: string;
  confidence: number;
  initiator: string;
  authorization: string | null;
};

export type AuditEvent = {
  ts: string;
  actor: string;
  action: string;
  kind: "ai_recommendation" | "human_decision" | "system";
  payload: Record<string, unknown>;
  model_version?: string;
  result?: string;
};
