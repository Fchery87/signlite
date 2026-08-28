import { act, render, screen } from '@testing-library/react';
import { DrawPad } from '../../src/components/library/DrawPad';
import { renderStrokes, type DrawStroke } from '../../src/components/library/canvas';

vi.mock('../../src/db/signatures', () => ({
  saveAsset: vi.fn(async () => ({ id: 'a1' }))
}));

function pointer(type: string, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.assign(event, { clientX, clientY, pointerId: 1 });
  return event;
}

function drawSurface() {
  const canvas = document.querySelector('div[role=dialog] canvas') as HTMLCanvasElement;
  // jsdom reports a zero-size box; give the pad real geometry so points map sanely.
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 600, height: 250 }) as DOMRect;
  canvas.setPointerCapture = () => {};
  return canvas;
}

describe('DrawPad', () => {
  it('records strokes and keeps them valid across leave/resume gestures', () => {
    const { container } = render(<DrawPad open onClose={() => {}} onSaved={() => {}} onToast={() => {}} />);
    const canvas = drawSurface();

    expect(() => {
      act(() => canvas.dispatchEvent(pointer('pointerdown', 10, 10)));
      for (let i = 0; i < 5; i += 1) {
        act(() => {
          canvas.dispatchEvent(pointer('pointermove', 20 + i * 10, 20));
          canvas.dispatchEvent(pointer('pointerleave', 20 + i * 10, 20));
        });
        act(() => canvas.dispatchEvent(pointer('pointerdown', 30 + i * 10, 30)));
      }
    }).not.toThrow();

    expect(container.querySelector('canvas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
  });

  it('undoes a pen stroke on Ctrl+Z instead of letting it reach the editor', () => {
    const editorUndo = vi.fn();
    window.addEventListener('keydown', editorUndo);

    render(<DrawPad open onClose={() => {}} onSaved={() => {}} onToast={() => {}} />);
    const canvas = drawSurface();

    act(() => canvas.dispatchEvent(pointer('pointerdown', 10, 10)));
    act(() => canvas.dispatchEvent(pointer('pointerup', 10, 10)));
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
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
      [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      null as unknown as DrawStroke,
      [{ x: 3, y: 3 }, { x: 4, y: 4 }]
    ];

    expect(() => renderStrokes(canvas, strokes)).not.toThrow();
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(2);
  });
});
