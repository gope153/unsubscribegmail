const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');

// Hauptfenster-Variable
let mainWindow;

// App initialisieren
app.on('ready', () => {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // Lade die Preload-Datei
            contextIsolation: true, // Aktivieren für sichere IPC-Kommunikation
            nodeIntegration: false, // Node.js im Renderer deaktivieren
        }
    });
    mainWindow.loadFile(path.join(__dirname, 'html', 'renderer.html')); // Lade die Benutzeroberfläche
});

// Beende die App, wenn alle Fenster geschlossen werden
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Starte den Node.js-Prozess aus `index.js`, wenn der Benutzer startet
ipcMain.on('start-script', (event, { emailCheckLimit, runHeadless }) => {
    event.reply('script-log', 'Starting!');

    const child = fork(path.join(__dirname, 'server.js'), [], {
        env: {
            EMAIL_CHECK_LIMIT: emailCheckLimit,
            RUN_HEADLESS: runHeadless
        }
    });

    child.on('message', (message) => {
        // Stelle sicher, dass das Fenster existiert und bereit ist
        if (mainWindow && mainWindow.webContents) {
            if (message.type !== undefined && message.type === 'email-data') {
                mainWindow.webContents.send('email-data', message.data);

            } else {
                mainWindow.webContents.send('script-log', message);
            }
            // Sende die Nachricht an die Renderer-UI
        } else {
            console.error('MainWindow is not available. Unable to send message.');
        }
    });
    child.on('exit', (code) => {
        console.log(`Process exited with code ${code}`);

        event.reply('script-exit', `Process exited with code ${code}`);
    });
});