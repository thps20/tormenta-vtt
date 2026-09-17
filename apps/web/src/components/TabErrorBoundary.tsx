import React from 'react';

interface Props {
  children: React.ReactNode;
  /** Só pra mensagem no console — identifica qual aba quebrou. */
  label: string;
}

interface State {
  error: Error | null;
}

/**
 * Isola um erro de runtime de UMA aba do painel lateral: sem isto, um erro de render em qualquer
 * aba (ex.: um loop infinito de setState) sobe pela árvore inteira até não achar nenhum
 * `componentDidCatch` — e como não havia nenhum, a tela toda ficava preta (React desmonta a
 * aplicação inteira quando um erro não é pego por um boundary). Um boundary POR ABA, não um só ao
 * redor do `SidePanel` inteiro, garante que só a aba que quebrou vira a mensagem de erro — as
 * outras abas (chat, iniciativa, fichas) continuam funcionando.
 *
 * Boundary de erro só existe como classe (React ainda não tem equivalente em hook).
 */
export class TabErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[TabErrorBoundary] erro na aba "${this.props.label}":`, error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="font-ui h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-text-muted">Algo deu errado nesta aba.</p>
          {/* Recarrega a página inteira (não só reseta o boundary): o erro pode ter deixado alguma
           *  store num estado inconsistente, e a sala reconecta sozinha ao voltar (sessionToken em
           *  localStorage) — mais simples e mais confiável que tentar remontar só esta aba. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="focus-ring px-3 py-1.5 rounded-ui text-xs font-bold bg-surface-2 hover:bg-surface-3 text-text transition-colors cursor-pointer"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
