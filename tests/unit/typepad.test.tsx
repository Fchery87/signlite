import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

const canvasMocks = vi.hoisted(() => ({
  renderTypedTextToCanvas: vi.fn(() => ({
    width: 220,
    height: 120,
    toDataURL: () => 'data:image/png;base64,AAAA'
  })),
  canvasToPngBytes: vi.fn(async () => new ArrayBuffer(8))
}));

vi.mock('../../src/components/library/canvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/library/canvas')>()),
  renderTypedTextToCanvas: canvasMocks.renderTypedTextToCanvas,
  canvasToPngBytes: canvasMocks.canvasToPngBytes
}));

import { deleteAsset, listAssets } from '../../src/db/signatures';
import { openSignliteDb } from '../../src/db/schema';
import { TypePad } from '../../src/components/library/TypePad';
import { STRINGS } from '../../src/lib/strings';

type FakeFace = { family: string; status: string };

/** Models the part of FontFaceSet the app actually uses: `load`, `add`, and
 *  iteration for face status. `document.fonts.check` is deliberately absent,
 *  because the app does not rely on it: a face left in `error` by a failed
 *  fetch makes `check` report false even after a recovery face has loaded. */
function installFonts(state: { loaded: () => boolean }) {
  const faces: FakeFace[] = [
    { family: 'SignLite Caveat', status: 'unloaded' },
    { family: 'SignLite Homemade Apple', status: 'unloaded' }
  ];
  const fonts = {
    load: vi.fn(async () => {
      if (!state.loaded()) {
        faces[0]!.status = 'error';
        throw new Error('network');
      }
      faces[0]!.status = 'loaded';
      return [];
    }),
    add: vi.fn((face: FakeFace) => { faces.push(face); }),
    [Symbol.iterator]: () => faces.map((face) => ({ ...face }))[Symbol.iterator]()
  };
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });

  class FakeFontFace implements FakeFace {
    status = 'loading';
    constructor(public family: string) {}
    async load() {
      this.status = state.loaded() ? 'loaded' : 'error';
      return this;
    }
  }
  vi.stubGlobal('FontFace', FakeFontFace);
  return fonts;
}

async function clearLibrary() {
  await Promise.all((await listAssets()).map((asset) => deleteAsset(asset.id)));
  const db = await openSignliteDb();
  await db.clear('prefs');
}

describe('TypePad font readiness', () => {
  beforeEach(async () => {
    await clearLibrary();
    canvasMocks.renderTypedTextToCanvas.mockClear();
    canvasMocks.canvasToPngBytes.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves typed text after the bundled font verifies', async () => {
    const fonts = installFonts({ loaded: () => true });
    const onSaved = vi.fn();
    const { getByPlaceholderText, getByText } = render(
      <TypePad open onClose={() => undefined} onSaved={onSaved} onToast={() => undefined} />
    );

    fireEvent.change(getByPlaceholderText(STRINGS.library.typeNamePlaceholder), { target: { value: 'Ann Example' } });
    await waitFor(() => expect(fonts.load).toHaveBeenCalled());
    fireEvent.click(getByText('Save'));

    await waitFor(async () => {
      expect((await listAssets()).some((asset) => asset.label === 'Ann Example')).toBe(true);
    });
    // The asset becomes visible to a reader as soon as its transaction commits;
    // onSaved follows once the save's preference bookkeeping finishes.
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // A face that loads outright needs no recovery face.
    expect(fonts.add).not.toHaveBeenCalled();
  });

  it('refuses to save fallback typography and offers a retry that succeeds', async () => {
    let ready = false;
    const fonts = installFonts({ loaded: () => ready });
    const onSaved = vi.fn();
    const toasts: string[] = [];
    const { getByPlaceholderText, getByText, findByText } = render(
      <TypePad open onClose={() => undefined} onSaved={onSaved} onToast={(message) => toasts.push(message)} />
    );

    fireEvent.change(getByPlaceholderText(STRINGS.library.typeNamePlaceholder), { target: { value: 'Ann Example' } });
    await findByText(STRINGS.library.fontNotReady);
    fireEvent.click(getByText('Save'));
    await waitFor(() => expect(toasts).toContain(STRINGS.library.fontNotReady));
    expect(onSaved).not.toHaveBeenCalled();
    await waitFor(async () => expect(await listAssets()).toEqual([]));

    ready = true;
    fireEvent.click(getByText(STRINGS.library.retryFont));
    fireEvent.click(getByText('Save'));
    await waitFor(async () => {
      expect((await listAssets()).some((asset) => asset.label === 'Ann Example')).toBe(true);
    });
    // The asset becomes visible to a reader as soon as its transaction commits;
    // onSaved follows once the save's preference bookkeeping finishes.
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // The first face was stuck in `error`, so recovery had to add a fresh one.
    expect(fonts.add).toHaveBeenCalled();
  });
});