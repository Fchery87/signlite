import { fireEvent, render, screen } from '@testing-library/react';
import { LibraryTray } from '../../src/components/library/LibraryTray';
import { deleteAsset, saveAsset } from '../../src/db/signatures';

it('disables every Signature Library placement affordance while editing is locked', async () => {
  const asset = await saveAsset({ kind: 'signature', source: 'uploaded', pngBytes: new Uint8Array([1, 2, 3]).buffer,
    width: 20, height: 10, label: 'Locked signature' });
  const onPlaceAsset = vi.fn();
  const { unmount } = render(<LibraryTray onToast={() => {}} onPlaceAsset={onPlaceAsset}
    onAddDate={vi.fn()} onAddText={vi.fn()} placementDisabled />);
  expect(screen.getByRole('button', { name: 'Date' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Text' })).toBeDisabled();
  const label = await screen.findByText('Locked signature');
  const preview = label.closest('article')?.querySelector('button');
  expect(preview).not.toBeNull();
  expect(preview!).toHaveAttribute('draggable', 'false');
  const setData = vi.fn();
  expect(fireEvent.dragStart(preview!, { dataTransfer: { setData, effectAllowed: 'none' } })).toBe(false);
  expect(setData).not.toHaveBeenCalled();
  const place = screen.getByRole('button', { name: 'Place on page 1' });
  expect(place).toBeDisabled();
  fireEvent.click(place);
  expect(onPlaceAsset).not.toHaveBeenCalled();
  unmount();
  await deleteAsset(asset.id);
});
