import { render, screen, waitFor } from '@testing-library/react';
import { PageThumbnails } from '../../src/components/editor/PageThumbnails';
import { STRINGS } from '../../src/lib/strings';

const renderThumbnail = vi.hoisted(() => vi.fn(async () => ({ width: 120, height: 160 })));
vi.mock('../../src/pdf/render', () => ({ renderThumbnail, releaseThumbnails: vi.fn(async () => undefined) }));

const fakePdf = { numPages: 1, fingerprints: ['fp'] } as never;

function stubCanvas() {
  const drawn: string[] = [];
  HTMLCanvasElement.prototype.getContext = (() => ({
    clearRect: () => {},
    drawImage: () => drawn.push('drawImage')
  })) as unknown as HTMLCanvasElement['getContext'];
  return drawn;
}

describe('PageThumbnails', () => {
  it('paints the thumbnail and clears the loading skeleton', async () => {
    const drawn = stubCanvas();

    const { container } = render(
      <PageThumbnails pdf={fakePdf} documentId="d0" pageCount={1} activePage={0} onSelectPage={() => {}} />
    );

    // The canvas must stay mounted, otherwise the draw effect can never reach it
    // and the thumbnail is stuck on its skeleton forever.
    expect(container.querySelector('canvas')).toBeTruthy();

    await waitFor(() => expect(drawn).toContain('drawImage'));
    await waitFor(() => expect(screen.queryByText(STRINGS.loading.thumbnail)).toBeNull());
  });
});
