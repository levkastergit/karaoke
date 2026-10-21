const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const appDir = __dirname;
const electronExe = path.join(appDir, "node_modules", "electron", "dist", "electron.exe");
const displayName = "\u041A\u0430\u0440\u0430\u043E\u043A\u0435"; // Караоке
const tempName = "Karaoke.lnk";
const finalName = `${displayName}.lnk`;

function getDesktopDir() {
  try {
    const reg = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop',
      { encoding: "utf8" }
    );
    const match = reg.match(/REG_EXPAND_SZ\s+(.+)/);
    if (match) {
      let p = match[1].trim().replace(/%USERPROFILE%/gi, os.homedir());
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* ignore */
  }
  return path.join(os.homedir(), "Desktop");
}

function createShortcutVbs(desktopDir, fileName) {
  if (!fs.existsSync(electronExe)) {
    console.error("Сначала выполните: npm install");
    console.error("  cd", appDir);
    process.exit(1);
  }

  const app = appDir.replace(/\\/g, "\\\\");
  const desktop = desktopDir.replace(/\\/g, "\\\\");
  const electron = electronExe.replace(/\\/g, "\\\\");

  const vbs = `Option Explicit
Dim sh, sc
Set sh = CreateObject("WScript.Shell")
Set sc = sh.CreateShortcut("${desktop}\\\\${fileName}")
sc.TargetPath = "${electron}"
sc.Arguments = "."
sc.WorkingDirectory = "${app}"
sc.WindowStyle = 1
sc.Description = "Karaoke"
sc.IconLocation = "${electron},0"
sc.Save
`;

  const tempVbs = path.join(appDir, "_create_shortcut_tmp.vbs");
  fs.writeFileSync(tempVbs, "\uFEFF" + vbs, "utf16le");
  try {
    execSync(`cscript //nologo "${tempVbs}"`, { stdio: "pipe" });
  } finally {
    try {
      fs.unlinkSync(tempVbs);
    } catch {
      /* ignore */
    }
  }
}

function cleanupDesktop(desktopDir) {
  for (const file of fs.readdirSync(desktopDir)) {
    if (!file.endsWith(".lnk")) continue;
    if (file.toLowerCase() === "karaoke-test.lnk") {
      try {
        fs.unlinkSync(path.join(desktopDir, file));
      } catch {
        /* ignore */
      }
    }
    if (file.includes("Ð") || file.includes("Ñ")) {
      try {
        fs.unlinkSync(path.join(desktopDir, file));
      } catch {
        /* ignore */
      }
    }
  }
}

function main() {
  const desktop = getDesktopDir();
  const tempPath = path.join(desktop, tempName);
  const finalPath = path.join(desktop, finalName);

  cleanupDesktop(desktop);

  if (fs.existsSync(finalPath)) {
    try {
      fs.unlinkSync(finalPath);
    } catch {
      /* ignore */
    }
  }

  createShortcutVbs(desktop, tempName);

  if (!fs.existsSync(tempPath)) {
    console.error("Не удалось создать ярлык");
    process.exit(1);
  }

  if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
  fs.renameSync(tempPath, finalPath);

  console.log("Ярлык создан:", finalPath);
  console.log("Запуск:", electronExe);
}

main();
