import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui';
import { STRINGS } from '../lib/strings';

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

/**
 * Without a boundary, any render or effect throw unmounts the whole tree and
 * leaves a blank page with no way back. Saved signatures and the autosaved Work
 * Session survive in IndexedDB, so recovery is a reload away.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SignLite crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-mist p-6">
        <div className="surface-card max-w-lg p-6 shadow-panel" role="alert">
          <h1 className="text-h1 text-ink">{STRINGS.crash.title}</h1>
          <p className="mt-3 text-body text-quiet">{STRINGS.crash.body}</p>
          <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap bg-sunken p-3 text-caption text-quiet">
            {error.message}
          </pre>
          <div className="mt-5 flex gap-2">
            <Button onClick={() => window.location.reload()}>{STRINGS.crash.reload}</Button>
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>
              {STRINGS.crash.dismiss}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
