import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full min-h-0 grid place-items-center p-4">
          <div className="max-w-xs text-center">
            <div className="text-[13px] font-bold text-red-300 mb-1">{this.props.label ?? 'Something went wrong'}</div>
            <div className="text-[11px] text-fg-4 break-words mb-3">{this.state.error.message}</div>
            <button onClick={() => this.setState({ error: null })} className="px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">Retry</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
