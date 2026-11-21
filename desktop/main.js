// Echo Lingo for Windows: a standalone window that serves the bundled app (lessons + audio) offline.
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const WWW = path.join(__dirname, 'www');

// app://echo/... behaves like a normal secure website (fetch, audio streaming, localStorage)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 480, height: 860, minWidth: 360, minHeight: 600,
    backgroundColor: '#161513',
    title: 'Echo Lingo',
    icon: path.join(WWW, 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  // links to the web (updates, GitHub) open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); shell.openExternal(url); }
  });
  win.loadURL('app://echo/index.html');

  // ECHO_SMOKE=1: load the app, check lessons + audio inside it, print the result and quit (used for testing)
  if (process.env.ECHO_SMOKE) {
    win.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await win.webContents.executeJavaScript(`(async () => {
          const items = Object.keys(EL.D.items).length;
          const url = Object.values(EL.D.manifest)[0];
          const audio = (await fetch(url)).status;
          const play = await new Promise((r) => { const a = new Audio(url); a.oncanplaythrough = () => r('ok ' + a.duration.toFixed(2) + 's'); a.onerror = () => r('error'); setTimeout(() => r('timeout'), 4000); });
          return JSON.stringify({ items, audioFetch: audio, audioPlay: play, version: EL.APPV, desktop: !!navigator.userAgent.match(/Electron/) });
        })()`);
        console.log('SMOKE', res);
      } catch (e) { console.log('SMOKE FAILED', e.message); }
      app.quit();
    });
  }
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WWW, rel));
    if (!file.startsWith(WWW)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
