import { afterEach, expect, it, vi } from 'vitest';
import { prepareOffline } from '../../src/pwa/offline';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup() {
  vi.stubEnv('PROD', true);
  vi.stubGlobal('isSecureContext', true);
  const active = new EventTarget();
  const waiting = Object.assign(new EventTarget(), {state: 'installed', postMessage: vi.fn()});
  const registration = Object.assign(new EventTarget(), {active, waiting, installing: null});
  Object.assign(active, {postMessage: (_: string, ports: {onmessage: ((event: {data: {ready: boolean}}) => void) | null}[]) => {
    queueMicrotask(() => ports[0].onmessage?.({data: {ready: true}}));
  }});
  vi.stubGlobal('MessageChannel', class { port1 = {onmessage: null, close: vi.fn()}; port2 = this.port1; });
  Object.defineProperty(navigator, 'serviceWorker', {configurable: true, value: {register: vi.fn().mockResolvedValue(registration)}});
  return registration;
}
it('reports waiting updates without replacing or messaging the waiting worker', async () => {
  const registration = setup();
  const status = vi.fn();
  const stop = prepareOffline(status);
  await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('update-ready'));
  expect(registration.waiting.postMessage).not.toHaveBeenCalled();
  stop();
});
it('discovers a later waiting update without losing the active session', async () => {
  const registration = setup();
  const waiting = registration.waiting;
  Object.assign(registration, {waiting: null});
  const status = vi.fn();
  const stop = prepareOffline(status);
  await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('ready'));
  Object.assign(registration, {installing: waiting});
  registration.dispatchEvent(new Event('updatefound'));
  Object.assign(registration, {waiting});
  waiting.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('update-ready'));
  stop();
});
