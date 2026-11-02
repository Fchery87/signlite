export type OfflineStatus = 'preparing' | 'ready' | 'update-ready' | 'failed' | 'unsupported';

function cacheReady(worker: ServiceWorker, repair: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => { channel.port1.close(); resolve(false); }, 15000);
    channel.port1.onmessage = (event: MessageEvent<{ready?: boolean}>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data?.ready === true);
    };
    try { worker.postMessage(repair ? 'APP_CACHE_REPAIR' : 'APP_CACHE_STATUS', [channel.port2]); }
    catch { window.clearTimeout(timeout); channel.port1.close(); resolve(false); }
  });
}

// No skip-waiting, controllerchange reload, or claim: updates wait for closed tabs.
export function prepareOffline(onStatus: (status: OfflineStatus) => void, repair = false): () => void {
  let cancelled = false;
  const cleanups: (() => void)[] = [];
  const publish = (status: OfflineStatus) => { if (!cancelled) onStatus(status); };
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) {
    publish('unsupported');
    return () => { cancelled = true; };
  }
  publish('preparing');
  const timer = window.setTimeout(() => publish('failed'), 90000);
  const check = async (worker: ServiceWorker, registration: ServiceWorkerRegistration) => {
    const ready = await cacheReady(worker, repair);
    window.clearTimeout(timer);
    publish(ready ? (registration.waiting ? 'update-ready' : 'ready') : 'failed');
  };
  void navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).then((registration) => {
    if (cancelled) return;
    if (registration.active) void check(registration.active, registration);
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const changed = () => {
        if (worker.state === 'activated') void check(worker, registration);
        if (worker.state === 'installed' && registration.active) void check(registration.active, registration);
        if (worker.state === 'redundant' && !registration.active) {
          window.clearTimeout(timer);
          publish('failed');
        }
      };
      worker.addEventListener('statechange', changed);
      cleanups.push(() => worker.removeEventListener('statechange', changed));
      changed();
    };
    watch(registration.installing);
    const found = () => watch(registration.installing);
    registration.addEventListener('updatefound', found);
    cleanups.push(() => registration.removeEventListener('updatefound', found));
  }).catch(() => { window.clearTimeout(timer); publish('failed'); });
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    cleanups.forEach((cleanup) => cleanup());
  };
}
