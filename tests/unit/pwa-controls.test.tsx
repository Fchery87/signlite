import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PwaControls } from '../../src/pwa/PwaControls';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('does not register a service worker in development and explains unsupported offline launch', () => {
  render(<PwaControls />);
  expect(screen.getByRole('status')).toHaveTextContent('Offline launch unavailable');
  expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
});
it('offers honest manual iOS instructions rather than a fake install prompt', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  render(<PwaControls />);
  fireEvent.click(screen.getByRole('button', {name: 'How to install'}));
  expect(screen.getByRole('dialog')).toHaveTextContent('Add to Home Screen');
  expect(screen.getByRole('dialog')).toHaveTextContent('Safari');
});
it('only offers native installation after the browser supplies a prompt', async () => {
  render(<PwaControls />);
  const event = new Event('beforeinstallprompt', {cancelable: true});
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, {prompt, userChoice: Promise.resolve({outcome: 'dismissed'})});
  fireEvent(window, event);
  await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Install app'})); });
  expect(prompt).toHaveBeenCalledOnce();
});
