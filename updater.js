// Проверка и установка обновлений через GitHub Releases.
// Приложение собирается как portable .exe, поэтому обновление выполняется
// вручную: скачиваем новый .exe, после выхода подменяем им текущий файл
// и запускаем заново.
const { app, ipcMain, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");

const REPO = "levkastergit/karaoke";
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const USER_AGENT = `karaoke-monitor/${app.getVersion()}`;

let pendingUpdate = null; // { version, url, name, size, notes, htmlUrl }

function send(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function parseVersion(v) {
  const m = String(v).trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

// Путь к исходному portable .exe (electron-builder задаёт эту переменную).
function getPortableExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || null;
}

async function checkForUpdates() {
  const current = app.getVersion();
  const res = await fetch(API_LATEST, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  const release = await res.json();

  const version = String(release.tag_name || "").replace(/^v/i, "");
  const asset = (release.assets || []).find((a) => /\.exe$/i.test(a.name));

  if (!isNewer(version, current) || !asset) {
    pendingUpdate = null;
    return { available: false, current, latest: version || current };
  }

  pendingUpdate = {
    version,
    url: asset.browser_download_url,
    name: asset.name,
    size: asset.size,
    notes: release.body || "",
    htmlUrl: release.html_url,
  };
  return { available: true, current, latest: version, size: asset.size, notes: pendingUpdate.notes };
}

async function downloadTo(url, dest, onProgress) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Загрузка: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;

  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    if (onProgress) onProgress(received, total);
  });
  await pipeline(body, fs.createWriteStream(dest));
}

// Скрипт ждёт завершения приложения, подменяет .exe и запускает новую версию.
function writeSwapScript(targetExe, newExe) {
  const script = path.join(os.tmpdir(), `karaoke-update-${Date.now()}.cmd`);
  // timeout /t не работает без консоли (detached-процесс), поэтому пауза через ping.
  const lines = [
    "@echo off",
    "chcp 65001 >nul",
    "set TRIES=0",
    ":wait",
    `move /y "${newExe}" "${targetExe}" >nul 2>&1`,
    "if not errorlevel 1 goto done",
    "set /a TRIES+=1",
    "if %TRIES% geq 120 goto fail",
    "ping -n 2 127.0.0.1 >nul",
    "goto wait",
    ":done",
    `start "" "${targetExe}"`,
    "del \"%~f0\" & exit /b 0",
    ":fail",
    `del "${newExe}" >nul 2>&1`,
    `start "" "${targetExe}"`,
    "del \"%~f0\" & exit /b 1",
  ];
  fs.writeFileSync(script, lines.join("\r\n"), "utf8");
  return script;
}

async function installUpdate() {
  if (!pendingUpdate) {
    const info = await checkForUpdates();
    if (!info.available) return { ok: false, reason: "Обновлений нет" };
  }

  if (!app.isPackaged) {
    return { ok: false, reason: "Обновление недоступно в режиме разработки" };
  }

  const targetExe = getPortableExePath();
  if (!targetExe || !fs.existsSync(targetExe)) {
    return {
      ok: false,
      reason: "Не найден файл программы. Скачайте новую версию вручную.",
      url: pendingUpdate.htmlUrl,
    };
  }

  const newExe = path.join(path.dirname(targetExe), `.${path.basename(targetExe)}.new`);
  try {
    await downloadTo(pendingUpdate.url, newExe, (received, total) => {
      send("updater:progress", { received, total });
    });
  } catch (err) {
    try {
      fs.unlinkSync(newExe);
    } catch {
      /* ignore */
    }
    throw err;
  }

  const script = writeSwapScript(targetExe, newExe);
  const child = spawn("cmd.exe", ["/c", script], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  setTimeout(() => app.quit(), 300);
  return { ok: true };
}

function registerUpdater() {
  ipcMain.handle("updater:check", async () => {
    try {
      return await checkForUpdates();
    } catch (err) {
      return { error: err.message || String(err) };
    }
  });

  ipcMain.handle("updater:install", async () => {
    try {
      return await installUpdate();
    } catch (err) {
      return { ok: false, reason: err.message || String(err) };
    }
  });

  ipcMain.handle("updater:version", () => app.getVersion());
}

module.exports = { registerUpdater, checkForUpdates, installUpdate, writeSwapScript };
