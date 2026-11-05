import { AlertTriangle } from 'lucide-react';
import { Component, type ReactNode } from 'react';

/**
 * Se uma tela falhar, mostra um aviso no lugar dela em vez de apagar a aplicação
 * inteira (a tela preta). A troca de rota (`resetKey`) tenta de novo.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null; key?: string }
> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey?: string },
    state: { error: Error | null; key?: string },
  ) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    console.error('Falha na tela:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-full items-center justify-center bg-chat-bg px-6">
        <div className="max-w-sm text-center">
          <AlertTriangle size={28} className="mx-auto mb-3 text-danger" aria-hidden="true" />
          <h2 className="text-lg font-bold">Algo deu errado nesta tela</h2>
          <p className="mt-1 text-sm text-muted">
            O restante do sistema continua funcionando. Recarregue a página para tentar de novo; se
            o problema continuar, avise o suporte.
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-4 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-primary-ink"
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
