const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog, ipcMain, Menu, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

let mainWindow = null;
let server = null;
let logPath = null;

// Initialize logging folder and file
try {
  const userDataPath = app.getPath('userData');
  logPath = path.join(userDataPath, 'app.log');
  fs.writeFileSync(logPath, `${new Date().toISOString()} - Application started\n`);
} catch (e) {
  console.error("Failed to initialize log file", e);
}

function log(msg) {
  const line = `${new Date().toISOString()} - ${msg}`;
  console.log(line);
  if (logPath) {
    try {
      fs.appendFileSync(logPath, line + '\n');
    } catch (e) {}
  }
}

// Configure auto updater
autoUpdater.logger = {
  info: (msg) => log(`[AutoUpdater] ${msg}`),
  warn: (msg) => log(`[AutoUpdater WARN] ${msg}`),
  error: (msg) => log(`[AutoUpdater ERROR] ${msg}`)
};
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('app:update-status', data);
  }
}

autoUpdater.on('checking-for-update', () => {
  log("AutoUpdater: Checking for updates...");
  sendUpdateStatus({ status: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  log(`AutoUpdater: Update available v${info.version}`);
  sendUpdateStatus({ status: 'available', version: info.version });
});

autoUpdater.on('update-not-available', (info) => {
  log(`AutoUpdater: Update not available. Current version is up to date (v${info.version})`);
  sendUpdateStatus({ status: 'not-available', version: info.version });
});

autoUpdater.on('error', (err) => {
  log(`AutoUpdater error: ${err.message}`);
  sendUpdateStatus({ status: 'error', error: err.message });
});

autoUpdater.on('download-progress', (progressObj) => {
  log(`AutoUpdater download progress: ${Math.round(progressObj.percent)}%`);
  sendUpdateStatus({ status: 'downloading', percent: Math.round(progressObj.percent) });
});

autoUpdater.on('update-downloaded', (info) => {
  log(`AutoUpdater: Update downloaded v${info.version}`);
  sendUpdateStatus({ status: 'downloaded', version: info.version });

  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Redémarrer et installer', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
      title: 'Mise à jour prête',
      message: `La version ${info.version} de School's a été téléchargée.`,
      detail: 'Voulez-vous redémarrer l\'application maintenant pour appliquer la mise à jour ?'
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  }
});

// IPC handlers for frontend communication
ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

ipcMain.handle('app:check-for-updates', async () => {
  if (!app.isPackaged) {
    log("Check for updates skipped: running in development mode.");
    return { status: 'dev-mode', message: 'Mode développement : les mises à jour automatiques sont actives dans le setup installé.' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: 'ok', result };
  } catch (err) {
    log(`Check for updates manual trigger error: ${err.message}`);
    return { status: 'error', error: err.message };
  }
});

ipcMain.handle('app:quit-and-install', () => {
  autoUpdater.quitAndInstall(false, true);
});

function setupMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Recharger',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        { type: 'separator' },
        { role: 'quit', label: "Quitter School's" }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'forceReload', label: 'Forcer l\'actualisation' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Taille normale' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' }
      ]
    },
    {
      label: 'Aide & Mises à jour',
      submenu: [
        {
          label: 'Vérifier les mises à jour...',
          click: () => {
            if (app.isPackaged) {
              autoUpdater.checkForUpdates();
            } else if (mainWindow) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Mises à jour',
                message: 'Mode développement actif',
                detail: 'La vérification automatique des mises à jour s\'exécute lors du déploiement du setup NSIS.'
              });
            }
          }
        },
        { type: 'separator' },
        {
          label: "À propos de School's",
          click: () => {
            if (mainWindow) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: "À propos de School's",
                message: `School's v${app.getVersion()}`,
                detail: "Gestion scolaire & comptable complète.\n© 2026 School's."
              });
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function getNextAppDir() {
  if (!app.isPackaged) return __dirname;
  // .next et public sont copiés hors de l'archive asar (extraResources vers
  // resources/nextapp/), volontairement décorrélés du réglage "asar" du
  // bundle Electron principal (main.js/preload.js) : Next doit trouver les
  // deux comme sous-dossiers directs d'un même `dir`, ce qui casse dès que
  // l'un des deux se retrouve packé dans app.asar et l'autre non.
  const nextAppDir = path.join(process.resourcesPath, 'nextapp');
  const resourcesNext = path.join(nextAppDir, '.next');
  if (fs.existsSync(resourcesNext)) {
    log(`Found .next in resources/nextapp: ${resourcesNext}`);
    return nextAppDir;
  }
  const appPathNext = path.join(app.getAppPath(), '.next');
  if (fs.existsSync(appPathNext)) {
    log(`Found .next in appPath: ${appPathNext}`);
    return app.getAppPath();
  }
  return __dirname;
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    log("Starting Next.js initialization...");
    process.env.MBOASCHOOL_DESKTOP = '1';
    const dev = false;
    const appDir = getNextAppDir();
    log(`Next.js runtime directory: ${appDir}`);

    // `appDir` (resources/nextapp) ne contient QUE `.next` et `public` : aucun
    // `node_modules` n'existe dans son arborescence. Le bundle serveur de Next
    // (React inclus) a pourtant besoin de résoudre certains modules à
    // l'exécution, et Node ne cherche `node_modules` qu'en remontant depuis le
    // fichier qui `require()`, jamais depuis `dir`. Sans ce NODE_PATH, la
    // résolution échoue silencieusement et Next répond 200 avec un corps vide
    // au lieu de l'erreur réelle (page blanche, reproduit et confirmé hors
    // Electron). NODE_PATH n'est lu par Node qu'au démarrage du process : il
    // faut forcer `_initPaths()` pour qu'il prenne effet immédiatement.
    const nodeModulesDir = path.join(app.getAppPath(), 'node_modules');
    process.env.NODE_PATH = process.env.NODE_PATH
      ? `${nodeModulesDir}${path.delimiter}${process.env.NODE_PATH}`
      : nodeModulesDir;
    require('module').Module._initPaths();
    log(`NODE_PATH réglé sur : ${process.env.NODE_PATH}`);

    const nextApp = next({ dev, dir: appDir });
    const handle = nextApp.getRequestHandler();

    // Set a safety timeout to prevent infinite hanging
    const timeout = setTimeout(() => {
      log("Next.js server prepare timeout reached (45s). Resolving anyway to open window.");
      resolve();
    }, 45000);

    log("Calling nextApp.prepare()...");
    nextApp.prepare().then(() => {
      log("Next.js prepare completed successfully.");
      server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
      });

      server.on('error', (err) => {
        log(`HTTP Server error occurred: ${err.message}`);
        clearTimeout(timeout);
        reject(err);
      });

      log("Listening on http://127.0.0.1:3000...");
      server.listen(3000, '127.0.0.1', () => {
        log("HTTP Server is listening successfully.");
        clearTimeout(timeout);
        if (mainWindow) {
          log("Server started listening after window creation. Reloading page...");
          mainWindow.loadURL('http://127.0.0.1:3000');
        }
        resolve();
      });
    }).catch(err => {
      log(`Next.js prepare failed: ${err.message}`);
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function createWindow() {
  log("Creating BrowserWindow...");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: "School's - Gestion Scolaire",
    autoHideMenuBar: false
  });

  // La page blanche vécue sur ce poste ne laissait aucune trace dans les
  // écouteurs ci-dessous (did-fail-load/console-message ne couvrent que la
  // navigation principale et les appels explicites à console.*) : les échecs
  // de sous-ressources (chunks JS/CSS `_next/static/...`, appels réseau vers
  // Supabase) passent par un canal différent (Chromium "Log"/Network) que ces
  // événements WebContents ne remontent pas. On les capture explicitement ici.
  mainWindow.webContents.session.webRequest.onCompleted((details) => {
    if (details.statusCode >= 400) {
      log(`[Requête HTTP échouée] ${details.statusCode} ${details.method} ${details.url}`);
    }
  });
  mainWindow.webContents.session.webRequest.onErrorOccurred((details) => {
    if (details.error === 'net::ERR_ABORTED') return; // navigation annulée normale (ex. redirection), pas une vraie erreur
    log(`[Requête réseau en erreur] ${details.error} ${details.method} ${details.url}`);
  });

  log("Loading URL http://127.0.0.1:3000...");
  mainWindow.loadURL('http://127.0.0.1:3000');

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    log(`Window failed to load page: ${errorDescription} (${errorCode}) url=${validatedURL} isMainFrame=${isMainFrame}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log(`Window finished loading page (did-finish-load). Current URL: ${mainWindow.webContents.getURL()}`);
    // Instrumente la page pour remonter toute exception non interceptée
    // (window.onerror / promesses rejetées) vers console.error, seul canal
    // que 'console-message' capture déjà côté main process ; et prend un
    // instantané du DOM pour distinguer "rien n'a été rendu" de "rendu mais
    // invisible" (CSS).
    mainWindow.webContents.executeJavaScript(`
      window.addEventListener('error', (e) => console.error('[window.onerror]', e.message, e.filename + ':' + e.lineno));
      window.addEventListener('unhandledrejection', (e) => console.error('[unhandledrejection]', e.reason && e.reason.message || e.reason));
      console.log('[DOM snapshot] readyState=' + document.readyState + ' bodyChildren=' + document.body.children.length + ' bodyTextLength=' + document.body.innerText.length);
    `).catch((e) => log(`executeJavaScript injection failed: ${e.message}`));
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    log(`[Renderer console] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log(`Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  mainWindow.on('unresponsive', () => {
    log("BrowserWindow became unresponsive.");
  });

  mainWindow.on('closed', () => {
    log("BrowserWindow closed.");
    mainWindow = null;
  });

  // Check for updates on startup if packaged
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(e => {
        log(`AutoUpdater initial check error: ${e.message}`);
      });
    }, 5000);
  }
}

async function clearStaleServiceWorker() {
  // Des versions précédentes de l'app (avant que le build Electron ne
  // désactive le service worker PWA de serwist) ont pu laisser un SW actif
  // dans le profil userData. S'il reste enregistré, il peut intercepter la
  // navigation et servir une réponse périmée/vide -> page blanche au
  // démarrage. Nettoyage ponctuel, ne touche ni IndexedDB (file offline
  // SyncManager) ni localStorage.
  try {
    await session.defaultSession.clearStorageData({
      storages: ['serviceworkers', 'cachestorage'],
    });
    log("Cleared stale service workers / cache storage from previous installs.");
  } catch (e) {
    log(`Failed to clear stale service worker storage: ${e.message}`);
  }
}

app.on('ready', async () => {
  log("Electron app ready event received.");
  setupMenu();
  await clearStaleServiceWorker();
  try {
    await startNextServer();
    log("Server start routine finished. Creating window...");
    createWindow();
  } catch (err) {
    log(`Critical server launch error: ${err.message}`);
    dialog.showErrorBox(
      "Erreur de démarrage",
      "Impossible de lancer le serveur local de l'application : " + err.message
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  log("All windows closed.");
  if (server) {
    log("Closing HTTP server...");
    server.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  log("Application quitting.");
  if (server) {
    server.close();
  }
});
