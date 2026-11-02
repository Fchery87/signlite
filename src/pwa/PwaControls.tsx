import { useEffect, useState } from 'react';
import { Modal } from '../components/ui/Modal';
import { prepareOffline, type OfflineStatus } from './offline';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
};
const labels: Record<OfflineStatus, string> = {
  preparing: 'Preparing offline launch…',
  ready: 'Ready to launch offline',
  'update-ready': 'Offline app update ready. Finish your work, close all SignLite tabs, then reopen to use it.',
  failed: 'Offline launch preparation failed',
  unsupported: 'Offline launch unavailable in this browser or development mode'
};

export function PwaControls() {
  const [status, setStatus] = useState<OfflineStatus>('preparing');
  const [attempt, setAttempt] = useState(0);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [instructions, setInstructions] = useState(false);
  const [installed, setInstalled] = useState(() => window.matchMedia?.('(display-mode: standalone)').matches ?? false);
  const [installError, setInstallError] = useState(false);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  useEffect(() => prepareOffline(setStatus), [attempt]);
  useEffect(() => {
    const offered = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const completed = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', offered);
    window.addEventListener('appinstalled', completed);
    return () => {
      window.removeEventListener('beforeinstallprompt', offered);
      window.removeEventListener('appinstalled', completed);
    };
  }, []);
  const install = async () => {
    if (!prompt) return;
    setInstallError(false);
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { setInstallError(true); }
    finally { setPrompt(null); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span role="status" title="App resources only. Your PDFs still need to be opened or restored separately. Browser storage can be cleared or evicted.">{labels[status]}</span>
      {status === 'failed' && <button type="button" className="min-h-11 underline" onClick={() => setAttempt((value) => value + 1)}>Retry offline setup</button>}
      {!installed && prompt && <button type="button" className="min-h-11 underline" onClick={() => void install()}>Install app</button>}
      {!installed && ios && !prompt && <button type="button" className="min-h-11 underline" onClick={() => setInstructions(true)}>How to install</button>}
      {installError && <span role="alert">Installation was not available. Try your browser menu.</span>}
      <Modal open={instructions} title="Install SignLite on iPhone or iPad" onClose={() => setInstructions(false)}>
        <ol className="list-decimal space-y-3 pl-5">
          <li>Open this page in Safari.</li>
          <li>Tap Share, then Add to Home Screen. You may need to scroll the Share menu.</li>
          <li>Tap Add, then open SignLite from your Home Screen.</li>
        </ol>
        <p className="mt-4">Wait for “Ready to launch offline” before disconnecting. This saves the app, not your open PDFs. Browser storage can be cleared or evicted.</p>
      </Modal>
    </div>
  );
}
