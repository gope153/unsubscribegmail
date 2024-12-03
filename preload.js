const { contextBridge, ipcRenderer } = require('electron');

// Exponiere sichere APIs für die Renderer-UI
contextBridge.exposeInMainWorld('api', {
    send: (channel, data) => {
        // Erlaube nur bestimmte Kanäle
        const validChannels = ['start-script'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    receive: (channel, func) => {
        // Erlaube nur bestimmte Kanäle
        const validChannels = ['script-log', 'script-exit', 'email-data'];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
});