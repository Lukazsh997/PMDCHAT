import type { PushConfig } from '@plataforma/contracts';
import { api } from './api';
import { createStore } from './store';

/**
 * Service worker e Web Push. Em HTTP, só funcionam se o endereço estiver na política
 * do Chrome OverrideSecurityRestrictionsOnInsecureOrigin (a mesma das notificações).
 */
export type PushState = 'unavailable' | 'off' | 'on' | 'error';
export const pushStore = createStore<PushState>('off');

const supported = () =>
  window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) {
    pushStore.set('unavailable');
    return null;
  }
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    pushStore.set('unavailable');
    return null;
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Inscreve este navegador (se a pessoa já permitiu notificações). Seguro chamar
 * várias vezes: reaproveita a inscrição existente e só confirma no servidor.
 */
export async function ensurePushSubscription(): Promise<PushState> {
  if (!supported() || Notification.permission !== 'granted') {
    pushStore.set(supported() ? 'off' : 'unavailable');
    return pushStore.get();
  }
  try {
    const cfg = await api<PushConfig>('GET', '/push/config');
    if (!cfg.enabled || !cfg.publicKey) {
      pushStore.set('unavailable');
      return 'unavailable';
    }
    const reg =
      (await navigator.serviceWorker.getRegistration('/')) ?? (await registerServiceWorker());
    if (!reg) return pushStore.get();
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(cfg.publicKey),
      });
    }
    const json = sub.toJSON();
    await api('POST', '/push/subscriptions', { endpoint: json.endpoint, keys: json.keys });
    pushStore.set('on');
  } catch {
    pushStore.set('error');
  }
  return pushStore.get();
}

/** Ao sair: este navegador para de receber avisos desta conta. */
export async function dropPushSubscription(): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api('DELETE', '/push/subscriptions', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    /* sem service worker: nada a desfazer */
  } finally {
    pushStore.set('off');
  }
}

/* ------------------------- Instalar como aplicativo ------------------------- */

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** O Chrome oferece instalar quando o sistema cumpre os requisitos de PWA. */
export const installStore = createStore<InstallPrompt | null>(null);
export const installedStore = createStore<boolean>(
  typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches,
);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installStore.set(e as InstallPrompt);
  });
  window.addEventListener('appinstalled', () => {
    installStore.set(null);
    installedStore.set(true);
  });
}

export async function promptInstall(): Promise<boolean> {
  const p = installStore.get();
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  installStore.set(null);
  return outcome === 'accepted';
}
