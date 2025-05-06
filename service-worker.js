// Nom du cache pour l'application
const CACHE_NAME = 'todo-app-v1';

// Liste des ressources à mettre en cache
const urlsToCache = [
  './',
  './index.html',
  './styles-updated.css',
  './script-updated.js',
  './push-manager.js',
  './icon-192.png',
  './icon-512.png',
  './icon-add-96.png',
  './badge.png'
];

// Installation du service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache ouvert');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Activation du service worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((cacheName) => {
          return cacheName !== CACHE_NAME;
        }).map((cacheName) => {
          return caches.delete(cacheName);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interception des requêtes fetch pour implémenter la stratégie offline-first
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - retourner la réponse du cache
        if (response) {
          return response;
        }

        // Pas de correspondance dans le cache - récupérer depuis le réseau
        return fetch(event.request).then(
          (networkResponse) => {
            // Vérifier si on a reçu une réponse valide
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // Cloner la réponse car elle ne peut être consommée qu'une fois
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        );
      })
      .catch(() => {
        // Fallback pour pages offline
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});

// Gestion des notifications push
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.text();
    let notificationData;

    try {
      notificationData = JSON.parse(data);
    } catch (e) {
      notificationData = {
        title: 'Rappel de tâche',
        body: data
      };
    }

    event.waitUntil(
      self.registration.showNotification(notificationData.title, {
        body: notificationData.body,
        icon: './icon-192.png',
        badge: './badge.png',
        timestamp: Date.now(),
        vibrate: [200, 100, 200],
        requireInteraction: true,
        actions: [
          {
            action: 'view',
            title: 'Voir la tâche'
          },
          {
            action: 'complete',
            title: 'Marquer comme terminée'
          }
        ],
        data: notificationData
      })
    );
  }
});

// Gestion des clics sur les notifications
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const notification = event.notification;

  // URL de base de l'application
  const appUrl = self.location.origin + '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // Si une fenêtre est déjà ouverte, l'utiliser
      for (const client of clientList) {
        if (client.url.startsWith(appUrl) && 'focus' in client) {
          if (action === 'complete') {
            // Envoyer un message pour marquer la tâche comme terminée
            client.postMessage({
              type: 'COMPLETE_TASK',
              taskId: notification.data?.taskId
            });
          }
          return client.focus();
        }
      }
      // Si aucune fenêtre n'est ouverte, en ouvrir une nouvelle
      return clients.openWindow(appUrl);
    })
  );
});

// Vérification périodique des notifications en attente
const checkPendingNotifications = async () => {
  const now = Date.now();

  try {
    const allClients = await clients.matchAll();
    const pendingNotifications = JSON.parse(await getLocalStorage('pendingNotifications') || '[]');

    const remainingNotifications = pendingNotifications.filter(notification => {
      if (notification.timestamp <= now && !notification.notified) {
        // Afficher la notification
        self.registration.showNotification(notification.title || 'Rappel de tâche', {
          body: notification.body,
          icon: './icon-192.png',
          badge: './badge.png',
          tag: notification.tag,
          requireInteraction: true,
          data: notification
        });
        return false; // Retirer de la liste
      }
      return true; // Garder dans la liste
    });

    // Mettre à jour la liste des notifications en attente
    await setLocalStorage('pendingNotifications', JSON.stringify(remainingNotifications));

    // Informer tous les clients du changement
    allClients.forEach(client => {
      client.postMessage({
        type: 'NOTIFICATIONS_UPDATED',
        notifications: remainingNotifications
      });
    });
  } catch (error) {
    console.error('Erreur lors de la vérification des notifications:', error);
  }
};

// Vérifier les notifications toutes les minutes
setInterval(checkPendingNotifications, 60000);

// Gestionnaire de messages depuis le client
self.addEventListener('message', (event) => {
  const data = event.data;

  if (data.type === 'GET_STORAGE') {
    // Demande de récupération d'une valeur du localStorage
    event.ports[0].postMessage(self.storage ? self.storage[data.key] : null);
  } else if (data.type === 'SET_STORAGE') {
    // Mettre à jour le stockage local du SW
    if (!self.storage) {
      self.storage = {};
    }
    self.storage[data.key] = data.value;
  } else if (data.type === 'SCHEDULE_NOTIFICATION') {
    // Planifier une nouvelle notification
    if (!self.pendingNotifications) {
      self.pendingNotifications = [];
    }
    self.pendingNotifications.push(data.notification);
  } else if (data.type === 'CANCEL_NOTIFICATION') {
    // Annuler une notification planifiée
    if (self.pendingNotifications) {
      self.pendingNotifications = self.pendingNotifications.filter(
        n => n.id !== data.taskId
      );
    }
  }
});

// Synchronisation en arrière-plan
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-tasks') {
    event.waitUntil(syncPendingTasks());
  }
});

// Synchroniser les tâches en attente
const syncPendingTasks = async () => {
  try {
    const pendingTaskActions = JSON.parse(await getLocalStorage('pendingTaskActions') || '[]');

    if (pendingTaskActions.length > 0) {
      // Synchronisation avec le stockage principal
      const tasks = JSON.parse(await getLocalStorage('tasks') || '[]');

      pendingTaskActions.forEach(action => {
        if (action.type === 'ADD') {
          tasks.push(action.task);
        } else if (action.type === 'UPDATE') {
          const index = tasks.findIndex(t => t.id === action.task.id);
          if (index !== -1) {
            tasks[index] = action.task;
          }
        } else if (action.type === 'DELETE') {
          const index = tasks.findIndex(t => t.id === action.taskId);
          if (index !== -1) {
            tasks.splice(index, 1);
          }
        }
      });

      // Mettre à jour le stockage
      await setLocalStorage('tasks', JSON.stringify(tasks));
      await setLocalStorage('pendingTaskActions', '[]');

      // Notifier les clients ouverts
      const clientList = await clients.matchAll({ type: 'window' });
      for (const client of clientList) {
        client.postMessage({
          type: 'TASKS_SYNCED',
          tasks: tasks
        });
      }
    }
  } catch (error) {
    console.error('Erreur lors de la synchronisation des tâches:', error);
  }
};

// Helper functions pour accéder au localStorage depuis le service worker
const getLocalStorage = async (key) => {
  // D'abord vérifier le stockage local du SW
  if (self.storage && self.storage[key] !== undefined) {
    return self.storage[key];
  }

  // Ensuite vérifier dans les clients
  const clients = await self.clients.matchAll();
  if (clients.length > 0) {
    const client = clients[0];
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => resolve(event.data);
      client.postMessage({type: 'GET_STORAGE', key}, [channel.port2]);
    });
  }

  return null;
};

const setLocalStorage = async (key, value) => {
  // Mettre à jour le stockage local du SW
  if (!self.storage) {
    self.storage = {};
  }
  self.storage[key] = value;

  // Mettre à jour dans les clients
  const clients = await self.clients.matchAll();
  if (clients.length > 0) {
    const client = clients[0];
    client.postMessage({type: 'SET_STORAGE', key, value});
  }
};
