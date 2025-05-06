// Gestionnaire de notifications push
class PushManager {
    constructor() {
        this.subscriptionStatus = null;
        this.vapidPublicKey = 'BLB_8DXVyPu1OE6ZccJbgBl0CXlUl3CJIkqI4HG3r34KQQdvOPDgSYwwqP6QFqvZhBvBvqpKZfVNuHHjL4CrX5Y';
    }

    async getSubscriptionStatus() {
        if ('Notification' in window) {
            const permission = Notification.permission;
            const subscription = await this.getSubscription();
            
            return {
                status: permission === 'granted' && subscription ? 'subscribed' : permission,
                subscription: subscription
            };
        }
        return { status: 'unsupported' };
    }

    async requestPermission() {
        if (!('Notification' in window)) {
            console.error('Les notifications ne sont pas supportées');
            return false;
        }

        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                await this.subscribe();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Erreur lors de la demande de permission:', error);
            return false;
        }
    }

    async getSubscription() {
        if (!('serviceWorker' in navigator)) return null;

        try {
            const registration = await navigator.serviceWorker.ready;
            return await registration.pushManager.getSubscription();
        } catch (error) {
            console.error('Erreur lors de la récupération de l\'abonnement:', error);
            return null;
        }
    }

    async subscribe() {
        if (!('serviceWorker' in navigator)) {
            throw new Error('Service Worker non supporté');
        }

        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
            });

            console.log('Abonnement push réussi:', subscription);
            return subscription;
        } catch (error) {
            console.error('Erreur lors de l\'abonnement push:', error);
            throw error;
        }
    }

    async unsubscribe() {
        const subscription = await this.getSubscription();
        if (subscription) {
            try {
                await subscription.unsubscribe();
                console.log('Désabonnement push réussi');
                return true;
            } catch (error) {
                console.error('Erreur lors du désabonnement:', error);
                return false;
            }
        }
        return true;
    }

    async scheduleNotification(task) {
        if (!task.scheduledFor) return;

        try {
            const status = await this.getSubscriptionStatus();
            if (status.status !== 'subscribed') {
                throw new Error('Les notifications ne sont pas activées');
            }

            const pendingNotifications = JSON.parse(localStorage.getItem('pendingNotifications') || '[]');
            pendingNotifications.push({
                id: task.id,
                timestamp: task.scheduledFor,
                title: 'Rappel de tâche',
                body: task.text,
                tag: `task-${task.id}`
            });

            localStorage.setItem('pendingNotifications', JSON.stringify(pendingNotifications));
            
            // Informer le service worker
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.ready;
                registration.active.postMessage({
                    type: 'SCHEDULE_NOTIFICATION',
                    notification: {
                        id: task.id,
                        timestamp: task.scheduledFor,
                        title: 'Rappel de tâche',
                        body: task.text
                    }
                });
            }
        } catch (error) {
            console.error('Erreur lors de la planification de la notification:', error);
            throw error;
        }
    }

    async cancelNotification(taskId) {
        try {
            const pendingNotifications = JSON.parse(localStorage.getItem('pendingNotifications') || '[]');
            const updatedNotifications = pendingNotifications.filter(n => n.id !== taskId);
            localStorage.setItem('pendingNotifications', JSON.stringify(updatedNotifications));

            // Informer le service worker
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.ready;
                registration.active.postMessage({
                    type: 'CANCEL_NOTIFICATION',
                    taskId: taskId
                });
            }
        } catch (error) {
            console.error('Erreur lors de l\'annulation de la notification:', error);
            throw error;
        }
    }

    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
}

const pushManager = new PushManager();
export default pushManager;
