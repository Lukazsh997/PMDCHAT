/*
 * Service worker da plataforma: recebe as notificações de Web Push (quando a aba
 * não está aberta) e abre a conversa certa no clique. Não guarda páginas em cache:
 * o sistema depende do servidor e não funciona desconectado.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Nova mensagem', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      // Se alguma aba do sistema está visível, ela mesma avisa: não duplica.
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (tabs.some((c) => c.visibilityState === 'visible')) return;
      await self.registration.showNotification(data.title || 'Nova mensagem', {
        body: data.body || '',
        tag: data.tag,
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        data: { url: data.url || '/' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = tabs.find((c) => c.url.startsWith(self.location.origin));
      if (tab) {
        await tab.focus();
        if ('navigate' in tab) await tab.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
