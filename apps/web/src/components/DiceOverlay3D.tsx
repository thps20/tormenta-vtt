import React, { useEffect, useRef } from 'react';
import { useDiceOverlay3D, type DiceOverlay3DRequest } from '../store/diceOverlay3d';

/**
 * Dados físicos sobre o mapa (docs/SPEC.md, modo "3D" de animação de rolagem): usa
 * `@3d-dice/dice-box-threejs` (three.js + cannon-es), importado sob demanda (`import()`) só
 * quando o primeiro pedido chega — nunca no bundle principal. Camada absoluta dentro do `<main>`
 * do mapa (mesmo nível de `HandoutOverlay`/`DrawToolbar` em RoomPage.tsx), fundo transparente (o
 * mapa continua visível por baixo), `pointer-events` liberado só enquanto há dados em queda, pra
 * um clique em qualquer lugar da tela pular direto pro resultado.
 *
 * A física NUNCA decide o resultado: a notação forçada (`NdS@v1,v2,...`, ver `rollNotation`)
 * faz os dados assentarem exatamente nos valores que `roll.groups[].rolls` já tem — o servidor já
 * rolou, isto é só o enfeite. Se a lib falhar em carregar/inicializar (sem WebGL, erro de rede,
 * exceção — é um pacote sem atualização desde 2022, risco aceito no plano), cai pro modo
 * "simples" pelo resto da sessão via `markUnavailable` e esta rolagem específica não anima nada
 * (o cartão do chat já mostra o número certo de qualquer jeito).
 */
const CONTAINER_ID = 'dice-overlay-3d-canvas';
/** Trava de segurança: `box.roll()` é de uma lib sem atualização desde 2022 e pode nunca resolver
 *  (physics que não assenta, `requestAnimationFrame` que não roda em segundo plano...) — sem isso
 *  uma rolagem travada bloquearia a fila pro resto da sessão. Estoura pro mesmo fallback de
 *  qualquer outra falha (`markUnavailable`); a rolagem em si já está certa no cartão por baixo. */
const ROLL_TIMEOUT_MS = 5000;

/** Lados que a lib sabe desenhar (docs/SPEC.md permite fórmulas com qualquer `sides` até 1000;
 *  fora deste conjunto não dá pra representar em 3D — pula pra próxima da fila sem culpar a lib. */
const SUPPORTED_SIDES = new Set([2, 3, 4, 6, 8, 10, 12, 20, 100]);

function rollNotation(groups: DiceOverlay3DRequest['groups']): string | null {
  if (groups.length === 0 || groups.some((g) => !SUPPORTED_SIDES.has(g.sides))) return null;
  const terms = groups.map((g) => `${g.count}d${g.sides}`).join('+');
  const values = groups.flatMap((g) => g.rolls).join(',');
  return `${terms}@${values}`;
}

export const DiceOverlay3D: React.FC = () => {
  const queue = useDiceOverlay3D((s) => s.queue);
  const dequeue = useDiceOverlay3D((s) => s.dequeue);
  const markUnavailable = useDiceOverlay3D((s) => s.markUnavailable);
  const containerRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const skipRef = useRef(false);
  const skipResolveRef = useRef<(() => void) | null>(null);

  const current = queue[0];

  useEffect(() => {
    if (!current || runningRef.current) return;
    runningRef.current = true;
    skipRef.current = false;
    let cancelled = false;

    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      runningRef.current = false;
      dequeue();
    };

    void (async () => {
      const notation = rollNotation(current.groups);
      const container = containerRef.current;
      if (!notation || !container) {
        finish();
        return;
      }
      let renderer: { dispose?: () => void } | undefined;
      try {
        const { default: DiceBox } = await import('@3d-dice/dice-box-threejs');
        if (cancelled) return;
        container.innerHTML = '';
        const box = new DiceBox(`#${CONTAINER_ID}`, {
          assetPath: '/dice-box-threejs/',
          sounds: false,
          // Dado escuro, números dourados (docs/design/DESIGN.md) — cor fixa, não varia por
          // crítico/falha aqui (isso é destaque do ÍCONE no cartão, não do dado 3D). Campos
          // `foreground`/`background` (não `colors.fg/bg` — conferido no dist real do pacote,
          // `DiceColors.getColorSet`/`makeColorSet`; o preset embutido "white" usa essa forma).
          theme_customColorset: { name: 'grimorio', foreground: '#C79C54', background: '#1D1D1D', outline: 'black', texture: 'none' },
          theme_material: 'metal',
        });
        // `renderer` só existe depois de `initialize()` (a lib cria o WebGLRenderer lá dentro,
        // não no construtor) — captura aqui pra `dispose()` funcionar mesmo se `roll()` falhar.
        await box.initialize();
        renderer = box.renderer;
        if (cancelled || skipRef.current) return finish();
        const skipPromise = new Promise<void>((resolve) => {
          skipResolveRef.current = resolve;
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('dice-box-threejs: roll() não resolveu a tempo')), ROLL_TIMEOUT_MS);
        });
        await Promise.race([box.roll(notation), skipPromise, timeoutPromise]);
        skipResolveRef.current = null;
        if (cancelled) return;
        // Segura o resultado visível um instante antes de recolher a camada.
        await new Promise((r) => setTimeout(r, skipRef.current ? 0 : 700));
      } catch {
        markUnavailable();
      } finally {
        renderer?.dispose?.();
        if (container) container.innerHTML = '';
        finish();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [current, dequeue, markUnavailable]);

  if (!current) return null;

  return (
    <div
      className="absolute inset-0 z-40 cursor-pointer"
      title="Clique para pular a animação"
      onClick={() => {
        skipRef.current = true;
        skipResolveRef.current?.();
      }}
    >
      <div id={CONTAINER_ID} ref={containerRef} className="w-full h-full" />
    </div>
  );
};
