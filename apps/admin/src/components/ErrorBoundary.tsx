import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ApiError } from '../lib/api';

interface Props {
  children: ReactNode;
  /** Changing this value (e.g. the URL) clears a previous error so navigating away recovers the app. */
  resetKey?: string;
}

/** Catches render errors so one broken page shows a message instead of a blank white screen. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const requestId = error instanceof ApiError ? error.requestId : undefined;
    return (
      <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="text-lg font-semibold text-red-800">Something went wrong on this page</h2>
        <p className="mt-2 text-sm text-red-700">The rest of the admin console is unaffected. Try again, or go back to the dashboard.</p>
        <p className="mt-2 break-words text-xs text-red-600">{error.message}</p>
        {requestId && <p className="mt-1 text-xs text-red-500">Reference: {requestId}</p>}
        <div className="mt-4 flex justify-center gap-3">
          <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <a className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700" href="/">
            Dashboard
          </a>
        </div>
      </div>
    );
  }
}
