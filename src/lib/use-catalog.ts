import { useEffect, useState } from "react";
import { subscribeCatalog } from "@/lib/overrides";

export function useCatalogTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeCatalog(() => setTick((n) => n + 1)), []);
  return tick;
}
