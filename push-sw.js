self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body:event.data?.text?.() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'מעון הדס', {
    body:data.body || '', icon:data.icon || '/favicon-192x192.png?v=0171', badge:data.badge || '/favicon-32x32.png',
    tag:data.tag || 'hadas', data:{url:data.url || '/?push=notifications'}, dir:'rtl', lang:'he', renotify:true,
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        if ('navigate' in client) await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
