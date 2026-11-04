import { createStore } from './store';

/**
 * Notificações do Chrome. Em HTTP, o navegador só as permite se o endereço estiver
 * na política OverrideSecurityRestrictionsOnInsecureOrigin (ver docs/implantacao.md).
 */
export type NotifyState = 'unsupported' | 'blocked-insecure' | NotificationPermission;

function currentState(): NotifyState {
  if (typeof Notification === 'undefined')
    return window.isSecureContext ? 'unsupported' : 'blocked-insecure';
  if (!window.isSecureContext) return 'blocked-insecure';
  return Notification.permission;
}

export const notifyStore = createStore<NotifyState>(currentState());

export async function requestNotifications(): Promise<NotifyState> {
  if (currentState() === 'default') await Notification.requestPermission();
  notifyStore.set(currentState());
  return notifyStore.get();
}

export function showNotification(opts: {
  title: string;
  body: string;
  tag: string;
  onClick: () => void;
}): void {
  if (currentState() !== 'granted') return;
  const n = new Notification(opts.title, {
    body: opts.body,
    tag: opts.tag,
    icon: '/favicon.svg',
    silent: false,
  });
  n.onclick = () => {
    window.focus();
    opts.onClick();
    n.close();
  };
}

const baseTitle = document.title;
let faviconLink: HTMLLinkElement | null = null;
let originalFavicon = '';

/** Contador de não lidas no título da aba e um ponto no ícone. */
export function setUnreadBadge(count: number): void {
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${baseTitle}` : baseTitle;
  faviconLink ??= document.querySelector<HTMLLinkElement>('link[rel=icon]');
  if (!faviconLink) return;
  originalFavicon ||= faviconLink.href;
  faviconLink.href =
    count > 0
      ? 'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f3d3e"/><path d="M9 11.5a3.5 3.5 0 0 1 3.5-3.5h7a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-3.5 3.5H15l-4.2 3.4c-.5.4-1.3 0-1.3-.6V19.6A3.5 3.5 0 0 1 9 16.5z" fill="#f7f8f6"/><circle cx="24" cy="8" r="7" fill="#d93025"/></svg>',
        )
      : originalFavicon;
}
