import { useEffect, useState } from "react";
import { subscribeIdentidad } from "@/lib/identidad";
import { subscribeBoards, syncBoards } from "@/lib/boards";

export function useParteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const offIdentidad = subscribeIdentidad(bump);
    const offBoards = subscribeBoards(bump);
    // Las planillas se actualizan solas cuando llega una foto nueva.
    void syncBoards();
    const timer = setInterval(() => void syncBoards(), 20_000);
    return () => { offIdentidad(); offBoards(); clearInterval(timer); };
  }, []);
  return 0;
}
