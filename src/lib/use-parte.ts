import { useEffect, useState } from "react";
import { subscribeIdentidad } from "@/lib/identidad";

export function useParteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    return subscribeIdentidad(bump);
  }, []);
  return 0;
}
