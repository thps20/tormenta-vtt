import { useEffect, useRef } from "react";

const PREFIX = "▶ Seu turno · ";

/**
 * Marca o título da aba enquanto é a vez do participante, pra chamar atenção de quem
 * está em outra aba (sem depender de notificação do SO). Restaura ao sair/desmontar.
 */
export function useTurnTitle(isMyTurn: boolean): void {
  const original = useRef<string | null>(null);

  useEffect(() => {
    if (original.current === null) original.current = document.title;
    document.title = isMyTurn ? `${PREFIX}${original.current}` : original.current;
  }, [isMyTurn]);

  useEffect(
    () => () => {
      if (original.current !== null) document.title = original.current;
    },
    [],
  );
}
