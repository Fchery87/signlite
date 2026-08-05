import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import { STRINGS } from '../../src/lib/strings';

function Boom(): never {
  throw new Error('render exploded');
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('shows a recovery screen instead of a blank page when a child throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(STRINGS.crash.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: STRINGS.crash.reload })).toBeTruthy();
    // The failure surfaces to the user rather than unmounting the tree.
    expect(container.textContent).toContain('render exploded');

    consoleError.mockRestore();
  });
});
