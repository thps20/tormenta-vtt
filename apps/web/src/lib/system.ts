import { useMemo } from "react";
import { getSystemDefinition, type SystemDefinition } from "@tormenta-vtt/shared";
import { useRoom } from "../store/room";

/** Definição do sistema da sala (mesmo JSON que o servidor usa). null fora de uma sala. */
export function useSystemDef(): SystemDefinition | null {
  const systemId = useRoom((s) => s.room?.systemId ?? null);
  return useMemo(() => {
    if (!systemId) return null;
    try {
      return getSystemDefinition(systemId);
    } catch {
      return null;
    }
  }, [systemId]);
}

/** "+3" / "-1" / "0" para bônus. */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
