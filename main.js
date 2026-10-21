const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const { registerUpdater } = require("./updater");

// Меньший аудиобуфер в Chromium (меньше задержка вывода)
app.commandLine.appendSwitch("audio-buffer-size", "64");

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 680,
    minWidth: 400,
    minHeight: 600,
    title: "Караоке — мониторинг микрофона",
    backgroundColor: "#0f0f14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "src", "index.html"));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "microphone");
  });

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === "media" || permission === "microphone";
  });

  registerUpdater();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
