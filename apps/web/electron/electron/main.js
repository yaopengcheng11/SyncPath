const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: "Team Roadmap & Sync Log",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Allows simple communication for this example
      devTools: true
    }
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    // In dev mode, load from Vite dev server
    win.loadURL('http://localhost:5183');
    // Open DevTools
    // win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, load the built html file
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
