document.addEventListener('DOMContentLoaded', () => {
    const taskInput = document.getElementById('taskInput');
    const taskDateTime = document.getElementById('taskDateTime');
    const addTaskBtn = document.getElementById('addTask');
    const todoList = document.getElementById('todoList');
    const scheduleBtn = document.getElementById('scheduleBtn');
    const scheduleContainer = document.getElementById('scheduleContainer');
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notificationText');
    const closeNotification = document.getElementById('closeNotification');

    // Charger les tâches depuis le localStorage
    let tasks = JSON.parse(localStorage.getItem('tasks')) || [];

    const saveTasks = () => {
        localStorage.setItem('tasks', JSON.stringify(tasks));
    };

    const deleteTask = (div, task) => {
        div.style.animation = 'fadeOut 0.3s ease-out forwards';
        setTimeout(() => {
            div.remove();
            tasks = tasks.filter(t => t !== task);
            saveTasks();
        }, 300);
    };

    const createTaskElement = (task) => {
        const div = document.createElement('div');
        div.className = `todo-item ${task.completed ? 'completed' : ''}`;
        
        const scheduleText = task.scheduledFor ? 
            `<span class="schedule-info">📅 ${new Date(task.scheduledFor).toLocaleString()}</span>` : '';
        
        div.innerHTML = `
            <input type="checkbox" ${task.completed ? 'checked' : ''}>
            <span>${task.text}</span>
            ${scheduleText}
            <button class="delete-btn"><i class="fas fa-trash"></i></button>
        `;

        const checkbox = div.querySelector('input');
        checkbox.addEventListener('change', () => {
            div.style.animation = 'pulse 0.3s ease';
            task.completed = checkbox.checked;
            div.classList.toggle('completed');
            saveTasks();
        });

        const deleteBtn = div.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', () => {
            deleteTask(div, task);
        });

        return div;
    };

    const showNotification = (text) => {
        notification.style.animation = 'slideInRight 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
        notificationText.textContent = text;
        notification.classList.remove('hidden');
        notification.classList.add('show');
        
        // Fermeture automatique après 5 secondes
        setTimeout(() => {
            hideNotification();
        }, 5000);
    };

    const hideNotification = () => {
        notification.classList.remove('show');
        notification.classList.add('hidden');
    };

    closeNotification.addEventListener('click', hideNotification);

    // Initialisation des notifications système
    const initSystemNotifications = async () => {
        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            if (permission === 'granted' && 'serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.register('sw.js');
                return registration;
            }
        }
        return null;
    };

    const scheduleSystemNotification = async (task) => {
        const notifications = JSON.parse(localStorage.getItem('pendingNotifications') || '[]');
        notifications.push({
            id: Date.now(),
            title: task.text,
            timestamp: task.scheduledFor
        });
        localStorage.setItem('pendingNotifications', JSON.stringify(notifications));

        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'NEW_TASK',
                task: task
            });
        }
    };

    const addTask = async (text, scheduledFor) => {
        if (text.trim() === '') return;

        const task = {
            id: Date.now(),
            text: text,
            completed: false,
            scheduledFor: scheduledFor || null,
            notified: false
        };

        tasks.push(task);
        todoList.appendChild(createTaskElement(task));
        saveTasks();

        if (scheduledFor) {
            await initSystemNotifications();
            await scheduleSystemNotification(task);

            const timeUntilTask = new Date(scheduledFor) - new Date();
            if (timeUntilTask > 0) {
                setTimeout(() => {
                    if (!task.completed) {
                        showNotification(`📅 Rappel: "${task.text}" est prévue maintenant!`);
                    }
                }, timeUntilTask);
            }
        }
    };

    // Gestion des messages du service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'GET_STORAGE') {
            event.ports[0].postMessage(localStorage.getItem(event.data.key));
        } else if (event.data.type === 'SET_STORAGE') {
            localStorage.setItem(event.data.key, event.data.value);
            // Mettre à jour l'interface si nécessaire
            if (event.data.key === 'tasks') {
                tasks = JSON.parse(event.data.value);
                updateTasksDisplay();
            }
        }
    });

    // Fonction pour mettre à jour l'affichage des tâches
    const updateTasksDisplay = () => {
        todoList.innerHTML = '';
        sortTasks().forEach(task => {
            todoList.appendChild(createTaskElement(task));
        });
    };

    // Initialisation du service worker au chargement
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('Service Worker registered'))
            .catch(error => console.log('Service Worker registration failed:', error));
    }

    // Événements
    scheduleBtn.addEventListener('click', () => {
        scheduleContainer.classList.toggle('hidden');
    });

    addTaskBtn.addEventListener('click', async () => {
        await addTask(taskInput.value, taskDateTime.value);
        taskInput.value = '';
        taskDateTime.value = '';
        scheduleContainer.classList.add('hidden');
    });

    taskInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            await addTask(taskInput.value, taskDateTime.value);
            taskInput.value = '';
            taskDateTime.value = '';
            scheduleContainer.classList.add('hidden');
        }
    });

    // Trier les tâches par date lors de l'affichage
    const sortTasks = () => {
        return tasks.sort((a, b) => {
            if (!a.scheduledFor) return 1;
            if (!b.scheduledFor) return -1;
            return new Date(a.scheduledFor) - new Date(b.scheduledFor);
        });
    };

    // Afficher les tâches existantes
    sortTasks().forEach(task => {
        todoList.appendChild(createTaskElement(task));
    });
});
