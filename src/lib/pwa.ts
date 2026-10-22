interface InstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const INSTALL_EVENT = 'candidate-master:install-state';

let deferredPrompt: InstallPromptEvent | null = null;
let initialized = false;

function emitInstallState() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(INSTALL_EVENT));
}

export function initPwa(): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    emitInstallState();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emitInstallState();
  });
}

export function installStateEventName() {
  return INSTALL_EVENT;
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function canInstall(): boolean {
  return Boolean(deferredPrompt) && !isStandalone();
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  emitInstallState();
  return choice.outcome === 'accepted';
}

export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const register = () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // The trainer still works normally without offline support.
    });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
