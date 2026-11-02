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
  expect(screen.queryByRole('button', {name: 'Install app'})).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('hides manual installation guidance when already launched standalone', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({matches: true}));
  render(<PwaControls />);
  expect(screen.queryByRole('button', {name: 'How to install'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Install app'})).not.toBeInTheDocument();
});

it('consumes a rejected prompt and allows a fresh browser offer to recover', async () => {
  render(<PwaControls />);
  const failed = new Event('beforeinstallprompt', {cancelable: true});
  const rejectedPrompt = vi.fn().mockRejectedValue(new Error('prompt unavailable'));
  Object.assign(failed, {prompt: rejectedPrompt, userChoice: Promise.resolve({outcome: 'dismissed'})});
  fireEvent(window, failed);
  expect(failed.defaultPrevented).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Install app'})); });
  expect(screen.getByRole('alert')).toHaveTextContent('Try your browser menu');
  expect(screen.queryByRole('button', {name: 'Install app'})).not.toBeInTheDocument();

  const offered = new Event('beforeinstallprompt', {cancelable: true});
  const freshPrompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(offered, {prompt: freshPrompt, userChoice: Promise.resolve({outcome: 'accepted'})});
  fireEvent(window, offered);
  await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Install app'})); });
  expect(rejectedPrompt).toHaveBeenCalledOnce();
  expect(freshPrompt).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Install app'})).not.toBeInTheDocument();
});

it('removes a pending offer when the browser reports completed installation', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
  render(<PwaControls />);
  const prompt = vi.fn().mockResolvedValue(undefined);
  const offered = new Event('beforeinstallprompt', {cancelable: true});
  Object.assign(offered, {prompt, userChoice: Promise.resolve({outcome: 'accepted'})});
  fireEvent(window, offered);
  expect(screen.getByRole('button', {name: 'Install app'})).toBeVisible();
  fireEvent(window, new Event('appinstalled'));
  expect(prompt).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', {name: 'Install app'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'How to install'})).not.toBeInTheDocument();
});
