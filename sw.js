self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Vérifier les notifications toutes les minutes
setInterval(() => {
    checkPendingNotifications();
}, 60000);

const checkPendingNotifications = async () => {
    const notifications = JSON.parse(await getLocalStorage('pendingNotifications') || '[]');
    const now = new Date();
    
    const pendingNotifications = notifications.filter(notif => {
        const notifTime = new Date(notif.timestamp);
        if (notifTime <= now) {
            self.registration.showNotification('Rappel de tâche', {
                body: notif.title,
                icon: '/icon.png',
                badge: '/badge.png',
                requireInteraction: true
            });
            return false;
        }
        return true;
    });

    await setLocalStorage('pendingNotifications', JSON.stringify(pendingNotifications));
};

// Helper functions pour accéder au localStorage depuis le service worker
const getLocalStorage = async (key) => {
    const clients = await self.clients.matchAll();
    const client = clients[0];
    if (client) {
        return new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => resolve(event.data);
            client.postMessage({type: 'GET_STORAGE', key}, [channel.port2]);
        });
    }
    return null;
};

const setLocalStorage = async (key, value) => {
    const clients = await self.clients.matchAll();
    const client = clients[0];
    if (client) {
        client.postMessage({type: 'SET_STORAGE', key, value});
    }
};
