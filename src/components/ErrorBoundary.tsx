import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Names the area in the fallback message, e.g. "This panel". */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps a crash in one area from blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        <div className="font-medium">{this.props.label} ran into a problem.</div>
        <div className="mt-1 text-xs break-words opacity-80">{this.state.error.message}</div>
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-3 rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
        >
          Try again
        </button>
      </div>
    );
  }
}
