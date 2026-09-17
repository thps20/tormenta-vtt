/**
 * `@3d-dice/dice-box-threejs` não publica tipos. Assinatura mínima usada por DiceOverlay3D.tsx
 * (constructor + initialize/roll), confirmada lendo o dist real do pacote (0.0.12) — o resto do
 * uso ainda é validado com um cast local no próprio componente.
 */
declare module "@3d-dice/dice-box-threejs" {
  export interface DiceBoxOptions {
    assetPath?: string;
    sounds?: boolean;
    theme_customColorset?: { name: string; foreground: string; background: string; outline?: string; texture?: string };
    theme_material?: "glass" | "metal" | "wood" | "plastic" | "none";
  }

  export default class DiceBox {
    constructor(selector: string, options?: DiceBoxOptions);
    initialize(): Promise<void>;
    roll(notation: string): Promise<unknown>;
    renderer?: { dispose?: () => void };
  }
}
