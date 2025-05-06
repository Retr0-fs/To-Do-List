import pushManager from './push-manager.js';

// Initialisation du service worker
async function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('./service-worker.js');
            console.log('Service Worker enregistré avec succès:', registration);
            
            // Vérifier si la synchronisation en arrière-plan est supportée
            if ('sync' in registration) {
                // S'assurer que les actions en attente sont synchronisées
                const pendingActions = JSON.parse(localStorage.getItem('pendingActions') || '[]');
                if (pendingActions.length > 0) {
                    await registration.sync.register('sync-pending-tasks');
                }
            }
        } catch (error) {
            console.error('Échec de l\'enregistrement du Service Worker:', error);
        }
    }
}

// Gestionnaire des messages du service worker
navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    
    switch (data.type) {
        case 'COMPLETE_TASK':
            if (data.taskId) {
                const taskElement = document.querySelector(`[data-task-id="${data.taskId}"]`);
                if (taskElement) {
                    const checkbox = taskElement.querySelector('input[type="checkbox"]');
                    if (checkbox && !checkbox.checked) {
                        checkbox.checked = true;
                        checkbox.dispatchEvent(new Event('change'));
                    }
                }
            }
            break;
            
        case 'NOTIFICATIONS_UPDATED':
            // Mettre à jour l'interface si nécessaire
            break;
            
        case 'GET_STORAGE':
            event.ports[0].postMessage(localStorage.getItem(data.key));
            break;
            
        case 'SET_STORAGE':
            localStorage.setItem(data.key, data.value);
            break;
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    // Sélecteurs DOM
    const taskInput = document.querySelector('#taskInput');
    const addTaskBtn = document.querySelector('#addTask');
    const todoList = document.querySelector('#todoList');
    const scheduleBtn = document.querySelector('#scheduleBtn');
    const scheduleContainer = document.querySelector('#scheduleContainer');
    const taskDateTime = document.querySelector('#taskDateTime');
    const notification = document.querySelector('#notification');
    const notificationText = document.querySelector('#notificationText');
    const closeNotification = document.querySelector('#closeNotification');
    const pushToggle = document.querySelector('#pushToggle');
    const offlineIndicator = document.querySelector('#offlineIndicator');

    if (!taskInput || !addTaskBtn || !todoList || !scheduleBtn || !scheduleContainer || !taskDateTime) {
        console.error('Éléments DOM manquants');
        return;
    }

    // État de l'application
    let tasks = [];
    let isOnline = navigator.onLine;
    let pendingActions = [];

    // Charger les tâches existantes
    loadTasks();
    updateTasksDisplay();

    // Gestionnaires d'événements pour le bouton d'ajout de tâche
    addTaskBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await handleAddTask();
    });

    // Gestionnaire d'événements pour la touche Entrée
    taskInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            await handleAddTask();
        }
    });

    // Gestionnaire d'événements pour le bouton de programmation
    scheduleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        scheduleContainer.classList.toggle('hidden');
        if (!scheduleContainer.classList.contains('hidden')) {
            const now = new Date();
            now.setMinutes(now.getMinutes() + 1);
            const minDateTime = now.toISOString().slice(0, 16);
            taskDateTime.min = minDateTime;
            taskDateTime.value = minDateTime;
        }
    });

    // Fonction pour gérer l'ajout de tâche
    async function handleAddTask() {
        const taskText = taskInput.value.trim();
        if (!taskText) {
            showNotification('Veuillez entrer une tâche', 'warning');
            return;
        }

        const scheduledTime = taskDateTime.value ? new Date(taskDateTime.value).getTime() : null;
        const success = await addTask(taskText, scheduledTime);

        if (success) {
            taskInput.value = '';
            taskDateTime.value = '';
            scheduleContainer.classList.add('hidden');
            showNotification('Tâche ajoutée avec succès', 'success');
        }
    }

    // Fonction pour vérifier et demander les permissions de notification
    async function checkAndRequestNotificationPermission() {
        try {
            if (!('Notification' in window)) {
                showNotification('Les notifications ne sont pas supportées par votre navigateur', 'warning');
                return false;
            }

            if (Notification.permission === 'granted') {
                return true;
            }

            if (Notification.permission !== 'denied') {
                const permission = await Notification.requestPermission();
                return permission === 'granted';
            }

            return false;
        } catch (error) {
            console.error('Erreur lors de la demande de permission:', error);
            return false;
        }
    }

    // Fonction pour ajouter une tâche
    async function addTask(text, scheduledFor = null) {
        try {
            const task = {
                id: Date.now(),
                text: text,
                completed: false,
                scheduledFor: scheduledFor,
                notified: false,
                createdAt: Date.now()
            };

            // Si c'est une tâche programmée, vérifier les permissions de notification
            if (scheduledFor) {
                const hasPermission = await checkAndRequestNotificationPermission();
                if (!hasPermission) {
                    showNotification('Les notifications sont nécessaires pour les tâches programmées', 'warning');
                    // Continuer quand même, mais sans notification
                }
            }

            // Créer et ajouter l'élément de tâche à l'interface
            const taskElement = createTaskElement(task);
            todoList.insertBefore(taskElement, todoList.firstChild);

            // Ajouter la tâche à l'état local
            tasks.push(task);
            saveTasks();

            // Planifier la notification si nécessaire
            if (scheduledFor && 'serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.ready;
                registration.active.postMessage({
                    type: 'SCHEDULE_NOTIFICATION',
                    notification: {
                        id: task.id,
                        timestamp: scheduledFor,
                        title: 'Rappel de tâche',
                        body: task.text,
                        tag: `task-${task.id}`
                    }
                });
            }

            return true;
        } catch (error) {
            console.error('Erreur lors de l\'ajout de la tâche:', error);
            showNotification('Erreur lors de l\'ajout de la tâche', 'error');
            return false;
        }
    }

    // Fonction pour charger les tâches
    function loadTasks() {
        try {
            const savedTasks = localStorage.getItem('tasks');
            if (savedTasks) {
                tasks = JSON.parse(savedTasks);
            }
        } catch (error) {
            console.error('Erreur lors du chargement des tâches:', error);
            tasks = [];
        }
    }

    // Fonction pour sauvegarder les tâches
    function saveTasks() {
        try {
            localStorage.setItem('tasks', JSON.stringify(tasks));
        } catch (error) {
            console.error('Erreur lors de la sauvegarde des tâches:', error);
            showNotification('Erreur lors de la sauvegarde', 'error');
        }
    }

    // Fonction pour créer un élément de tâche
    function createTaskElement(task) {
        const div = document.createElement('div');
        div.className = `todo-item ${task.completed ? 'completed' : ''}`;
        div.dataset.taskId = task.id;

        const scheduleText = task.scheduledFor ? 
            `<span class="schedule-info">📅 ${new Date(task.scheduledFor).toLocaleString()}</span>` : '';

        div.innerHTML = `
            <input type="checkbox" ${task.completed ? 'checked' : ''}>
            <span>${task.text}</span>
            ${scheduleText}
            <button class="delete-btn"><i class="fas fa-trash"></i></button>
        `;

        // Gestionnaire pour la case à cocher
        const checkbox = div.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', () => {
            task.completed = checkbox.checked;
            div.classList.toggle('completed');
            saveTasks();
        });

        // Gestionnaire pour le bouton de suppression
        const deleteBtn = div.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', () => {
            deleteTask(div, task);
        });

        return div;
    }

    // Fonction pour supprimer une tâche
    function deleteTask(div, task) {
        div.style.animation = 'fadeOut 0.3s ease-out forwards';
        
        setTimeout(async () => {
            div.remove();
            tasks = tasks.filter(t => t.id !== task.id);
            saveTasks();

            if (task.scheduledFor && 'serviceWorker' in navigator) {
                try {
                    const registration = await navigator.serviceWorker.ready;
                    registration.active.postMessage({
                        type: 'CANCEL_NOTIFICATION',
                        taskId: task.id
                    });
                } catch (error) {
                    console.error('Erreur lors de l\'annulation de la notification:', error);
                }
            }
        }, 300);
    }

    // Fonction pour afficher une notification
    function showNotification(text, type = 'info') {
        if (!notification || !notificationText) return;

        notification.className = `notification ${type}`;
        notification.style.animation = 'slideInRight 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
        notificationText.textContent = text;
        notification.classList.remove('hidden');
        notification.classList.add('show');

        setTimeout(() => {
            hideNotification();
        }, 5000);
    }

    // Fonction pour masquer une notification
    function hideNotification() {
        if (!notification) return;
        notification.classList.remove('show');
        notification.classList.add('hidden');
    }

    // Fonction pour mettre à jour l'affichage des tâches
    function updateTasksDisplay() {
        todoList.innerHTML = '';
        tasks.sort((a, b) => b.createdAt - a.createdAt)
             .forEach(task => {
                 const taskElement = createTaskElement(task);
                 todoList.appendChild(taskElement);
             });
    }

    // Gestionnaires d'événements pour le mode hors ligne
    window.addEventListener('online', () => {
        isOnline = true;
        offlineIndicator.classList.add('hidden');
        syncTasks();
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        offlineIndicator.classList.remove('hidden');
    });

    // Gestionnaire pour fermer les notifications
    if (closeNotification) {
        closeNotification.addEventListener('click', hideNotification);
    }

    // Gestionnaire pour le toggle des notifications push
    if (pushToggle) {
        pushToggle.addEventListener('change', async () => {
            if (pushToggle.checked) {
                const success = await pushManager.requestPermission();
                if (!success) {
                    pushToggle.checked = false;
                    showNotification('Impossible d\'activer les notifications', 'error');
                }
            } else {
                await pushManager.unsubscribe();
            }
        });

        // Vérifier l'état initial des notifications
        pushManager.getSubscriptionStatus().then(status => {
            pushToggle.checked = status.status === 'subscribed';
        });
    }

    // Synchronisation des tâches
    async function syncTasks() {
        if (pendingActions.length > 0) {
            try {
                await Promise.all(pendingActions.map(action => {
                    switch (action.type) {
                        case 'ADD':
                            return addTask(action.task.text, action.task.scheduledFor);
                        case 'DELETE':
                            return deleteTask(
                                document.querySelector(`[data-task-id="${action.taskId}"]`),
                                tasks.find(t => t.id === action.taskId)
                            );
                        default:
                            return Promise.resolve();
                    }
                }));
                pendingActions = [];
                localStorage.removeItem('pendingActions');
            } catch (error) {
                console.error('Erreur lors de la synchronisation:', error);
            }
        }
    }

    // Initialisation
    initServiceWorker();
});