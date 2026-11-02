import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { PageCanvas } from '../../src/components/editor/PageCanvas';

const startPageRender = vi.hoisted(() => vi.fn());
vi.mock('../../src/pdf/render', () => ({ startPageRender }));
vi.mock('../../src/components/editor/PlacementLayer', () => ({ PlacementLayer: () => <div data-testid="placement-tools" /> }));

class VisibleObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe() { this.callback([{ isIntersecting: true, intersectionRatio: 1 }] as IntersectionObserverEntry[], this as unknown as IntersectionObserver); }
  disconnect() {}
}

it('explains a page render failure and retries rather than showing an empty page', async () => {
  vi.stubGlobal('IntersectionObserver', VisibleObserver);
  startPageRender.mockImplementationOnce(() => ({ finished: Promise.reject(new Error('Page unavailable')), cancel: vi.fn() }));
  startPageRender.mockImplementation(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  const pdf = { destroy: vi.fn() } as never;
  const { unmount } = render(<PageCanvas pdf={pdf} documentId="doc" pageIndex={0} pageSize={{ w: 200, h: 300 }} placements={[]} scale={1} selectedPlacementId={null} scrollRootRef={createRef()} onVisibilityChange={vi.fn()} onPageElement={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Page 1 could not be displayed.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry page' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(startPageRender).toHaveBeenCalledTimes(2);
  unmount();
  vi.unstubAllGlobals();
});
