import { act, render, screen, waitFor } from '@testing-library/react';
import { saveAsset } from '../../src/db/signatures';
import { DrawPad } from '../../src/components/library/DrawPad';
import {
  renderStrokes,
  type DrawStroke
} from '../../src/components/library/canvas';

vi.mock('../../src/db/signatures', () => ({
  saveAsset: vi.fn(async () => ({ id: 'a1' }))
}));

vi.mock('../../src/components/library/canvas', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../src/components/library/canvas')
  >()),
  trimCanvas: (canvas: HTMLCanvasElement) => canvas,
  canvasToPngBytes: async () => new ArrayBuffer(8)
}));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

function pointer(
  type: string,
  clientX: number,
  clientY: number,
  extra: Partial<PointerEvent> = {}
) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true
  }) as PointerEvent;
  Object.assign(event, { clientX, clientY, pointerId: 1, ...extra });
  return event;
}

function drawSurface() {
  const canvas = document.querySelector(
    'div[role=dialog] canvas'
  ) as HTMLCanvasElement;
  // jsdom reports a zero-size box; give the pad real geometry so points map sanely.
  canvas.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 250 }) as DOMRect;
  canvas.setPointerCapture = () => {};
  return canvas;
}

describe('DrawPad', () => {
  it('saves pen pressure and mouse fallback points with completion callbacks', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <DrawPad open onClose={onClose} onSaved={onSaved} onToast={() => {}} />
    );
    const canvas = drawSurface();
    act(() =>
      canvas.dispatchEvent(
        pointer('pointerdown', 10, 10, { pointerType: 'pen', pressure: 0.8 })
      )
    );
    act(() =>
      canvas.dispatchEvent(
        pointer('pointerup', 20, 20, { pointerType: 'pen', pressure: 0.8 })
      )
    );
    act(() =>
      canvas.dispatchEvent(
        pointer('pointerdown', 30, 30, { pointerType: 'mouse', pressure: 0.5 })
      )
    );
    act(() =>
      canvas.dispatchEvent(
        pointer('pointerup', 40, 40, { pointerType: 'mouse', pressure: 0.5 })
      )
    );
    act(() => screen.getByRole('button', { name: 'Save' }).click());
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
    const saved = vi.mocked(saveAsset).mock.calls.at(-1)?.[0];
    expect(JSON.parse(saved!.strokeData!)).toEqual([
      [
        { x: 20, y: 20, pressure: 0.8 },
        { x: 40, y: 40, pressure: 0.8 }
      ],
      [
        { x: 60, y: 60 },
        { x: 80, y: 80 }
      ]
    ]);
  });
  it('names the aspect-correct surface and explains input', () => {
    render(
      <DrawPad open onClose={() => {}} onSaved={() => {}} onToast={() => {}} />
    );
    expect(
      screen.getByLabelText('Signature drawing canvas').className
    ).toContain('aspect-[12/5]');
    expect(screen.getByText(/finger, stylus, or mouse/i)).toBeVisible();
  });

  it('ignores concurrent pointers and releases capture on cancellation', () => {
    render(
      <DrawPad open onClose={() => {}} onSaved={() => {}} onToast={() => {}} />
    );
    const canvas = drawSurface();
    const capture = vi.fn();
    const release = vi.fn();
    canvas.setPointerCapture = capture;
    canvas.releasePointerCapture = release;
    act(() => canvas.dispatchEvent(pointer('pointerdown', 10, 10)));
    act(() =>
      canvas.dispatchEvent(pointer('pointerdown', 20, 20, { pointerId: 2 }))
    );
    expect(capture).toHaveBeenCalledTimes(1);
    act(() => canvas.dispatchEvent(pointer('pointercancel', 20, 20)));
    expect(release).toHaveBeenCalledWith(1);
    act(() =>
      canvas.dispatchEvent(pointer('pointerdown', 20, 20, { pointerId: 2 }))
    );
    expect(capture).toHaveBeenCalledTimes(2);
  });
  it('maps coalesced samples uniformly and stops after capture loss or clear', () => {
    render(
      <DrawPad open onClose={() => {}} onSaved={() => {}} onToast={() => {}} />
    );
    const canvas = drawSurface();
    const lineTo = vi.fn();
    canvas.getContext = (() => ({
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo,
      stroke() {}
    })) as unknown as HTMLCanvasElement['getContext'];
    act(() => canvas.dispatchEvent(pointer('pointerdown', 10, 10)));
    act(() =>
      canvas.dispatchEvent(
        pointer('pointermove', 30, 30, {
          getCoalescedEvents: () => [
            pointer('pointermove', 15, 20),
            pointer('pointermove', 25, 30)
          ]
        })
      )
    );
    expect(lineTo).toHaveBeenCalledWith(30, 40);
    expect(lineTo).toHaveBeenCalledWith(50, 60);
    act(() => canvas.dispatchEvent(pointer('lostpointercapture', 30, 30)));
    lineTo.mockClear();
    act(() => canvas.dispatchEvent(pointer('pointermove', 40, 40)));
    expect(lineTo).not.toHaveBeenCalled();
    act(() => canvas.dispatchEvent(pointer('pointerdown', 40, 40)));
    act(() => screen.getByRole('button', { name: 'Clear' }).click());
    act(() => canvas.dispatchEvent(pointer('pointermove', 50, 50)));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
  it('records strokes and keeps them valid across leave/resume gestures', () => {
    const { container } = render(
      <DrawPad open onClose={() => {}} onSaved={() => {}} onToast={() => {}} />
    );
    const canvas = drawSurface();

    expect(() => {
      act(() => canvas.dispatchEvent(pointer('pointerdown', 10, 10)));
      for (let i = 0; i < 5; i += 1) {
        act(() => {
          canvas.dispatchEvent(pointer('pointermove', 20 + i * 10, 20));
          canvas.dispatchEvent(pointer('pointerleave', 20 + i * 10, 20));
        });
        act(() =>
          canvas.dispatchEvent(pointer('pointerdown', 30 + i * 10, 30))
        );
      }
    }).not.toThrow();

    expect(container.querySelector('canvas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
  });

  it('undoes a pen stroke on Ctrl+Z instead of letting it reach the editor', () => {
    const editorUndo = vi.fn();
    window.addEventListener('keydown', editorUndo);

    render(
      <DrawPad open onClose={() => {}} onSaved={() => {}} onToast={() => {}} />
    );
    const canvas = drawSurface();

    act(() => canvas.dispatchEvent(pointer('pointerdown', 10, 10)));
    act(() => canvas.dispatchEvent(pointer('pointerup', 10, 10)));
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        })
      );
    });

    // The stroke is gone...
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    // ...and the event never bubbled on to the editor's window-level handler.
    expect(editorUndo).not.toHaveBeenCalled();

    window.removeEventListener('keydown', editorUndo);
  });
});

describe('renderStrokes', () => {
  it('renders a visible dot for a stationary down/up pair', () => {
    const canvas = document.createElement('canvas');
    const lineTo = vi.fn();
    canvas.getContext = (() => ({
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo,
      stroke() {}
    })) as unknown as HTMLCanvasElement['getContext'];
    renderStrokes(canvas, [
      [
        { x: 20, y: 30 },
        { x: 20, y: 30 }
      ]
    ]);
    expect(lineTo).toHaveBeenCalledWith(20.1, 30.1);
  });
  it('varies pen width but keeps legacy points at the default width', () => {
    const canvas = document.createElement('canvas');
    const widths: number[] = [];
    canvas.getContext = (() => ({
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      set lineWidth(value: number) {
        widths.push(value);
      }
    })) as unknown as HTMLCanvasElement['getContext'];
    renderStrokes(canvas, [
      [
        { x: 0, y: 0, pressure: 0.2 },
        { x: 1, y: 1, pressure: 0.2 }
      ],
      [
        { x: 0, y: 0, pressure: 1 },
        { x: 1, y: 1, pressure: 1 }
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ]
    ] as DrawStroke[]);
    expect(widths[1]).toBeLessThan(widths[2]);
    expect(widths.at(-1)).toBe(6);
  });
  it('ignores a malformed stroke instead of throwing', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const calls: string[] = [];
    canvas.getContext = (() => ({
      clearRect: () => calls.push('clear'),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => calls.push('stroke'),
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set lineCap(_v: string) {},
      set lineJoin(_v: string) {}
    })) as unknown as HTMLCanvasElement['getContext'];

    const strokes = [
      [
        { x: 1, y: 1 },
        { x: 2, y: 2 }
      ],
      null as unknown as DrawStroke,
      [
        { x: 3, y: 3 },
        { x: 4, y: 4 }
      ]
    ];

    expect(() => renderStrokes(canvas, strokes)).not.toThrow();
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(2);
  });
});
