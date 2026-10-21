const micSelect = document.getElementById("micSelect");
const outSelect = document.getElementById("outSelect");
const refreshBtn = document.getElementById("refreshBtn");
const karaokeBtn = document.getElementById("karaokeBtn");
const karaokeLabel = document.getElementById("karaokeLabel");
const volumeSlider = document.getElementById("volume");
const volumeValue = document.getElementById("volumeValue");
const statusEl = document.getElementById("status");
const keepAlive = document.getElementById("keepAlive");
const agcToggle = document.getElementById("agcToggle");
const nsToggle = document.getElementById("nsToggle");
const levelBar = document.getElementById("levelBar");

const BASE_GAIN = 6;
const HIGH_GAIN_WARNING_PERCENT = 700;
const METER_INTERVAL_MS = 80;

let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let gainNode = null;
let analyserNode = null;
let meterTimerId = null;
let karaokeOn = false;
let permissionGranted = false;

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}

function setKaraokeUi(on) {
  karaokeOn = on;
  karaokeBtn.classList.toggle("on", on);
  karaokeBtn.classList.toggle("off", !on);
  karaokeLabel.textContent = on ? "Караоке включено" : "Включить караоке";
  if (on) {
    updateLatencyStatus();
  } else if (permissionGranted) {
    setStatus("Караоке выключено");
  }
}

function updateLatencyStatus() {
  if (!audioContext || !karaokeOn) return;
  const sec = audioContext.baseLatency + (audioContext.outputLatency || 0);
  const ms = Math.round(sec * 1000);
  setStatus(`Караоке включено · задержка ~${ms} мс`, "active");
}

function sliderToGain(percent) {
  return (Number(percent) / 100) * BASE_GAIN;
}

function updateGain() {
  if (!gainNode) return;
  gainNode.gain.value = sliderToGain(volumeSlider.value);
}

function stopLevelMeter() {
  if (meterTimerId != null) {
    clearInterval(meterTimerId);
    meterTimerId = null;
  }
  levelBar.style.width = "0%";
}

function startLevelMeter() {
  if (!analyserNode) return;
  const data = new Uint8Array(analyserNode.fftSize);

  meterTimerId = setInterval(() => {
    if (!analyserNode) return;
    analyserNode.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    levelBar.style.width = `${Math.min(100, rms * 400)}%`;
  }, METER_INTERVAL_MS);
}

async function ensurePermission() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
    permissionGranted = true;
    return true;
  } catch {
    permissionGranted = false;
    setStatus(
      "Нет доступа к микрофону. Разрешите его в настройках Windows.",
      "error"
    );
    karaokeBtn.disabled = true;
    micSelect.disabled = true;
    refreshBtn.disabled = true;
    return false;
  }
}

async function loadDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === "audioinput");
  const outputs = devices.filter((d) => d.kind === "audiooutput");

  const prevMic = micSelect.value;
  const prevOut = outSelect.value;

  micSelect.innerHTML = "";
  if (inputs.length === 0) {
    micSelect.innerHTML = '<option value="">Микрофоны не найдены</option>';
    micSelect.disabled = true;
  } else {
    inputs.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Микрофон ${i + 1}`;
      micSelect.appendChild(opt);
    });
    micSelect.disabled = false;
    if (prevMic && inputs.some((d) => d.deviceId === prevMic)) {
      micSelect.value = prevMic;
    }
  }

  outSelect.innerHTML = '<option value="">По умолчанию (система)</option>';
  outputs.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Устройство ${i + 1}`;
    outSelect.appendChild(opt);
  });
  outSelect.disabled = outputs.length === 0;
  if (prevOut && outputs.some((d) => d.deviceId === prevOut)) {
    outSelect.value = prevOut;
  }

  refreshBtn.disabled = false;
  if (permissionGranted) {
    karaokeBtn.disabled = inputs.length === 0;
  }
}

function getAudioConstraints() {
  const deviceId = micSelect.value;
  const useNs = nsToggle.checked;
  const useAgc = agcToggle.checked;

  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: useNs,
      autoGainControl: useAgc,
      // Chromium: лишние фильтры WebRTC добавляют задержку
      googEchoCancellation: false,
      googAutoGainControl: useAgc,
      googNoiseSuppression: useNs,
      googHighpassFilter: false,
      googTypingNoiseDetection: false,
      googAudioMirroring: false,
    },
  };
}

function getContextSampleRate(stream) {
  const track = stream.getAudioTracks()[0];
  const rate = track?.getSettings?.()?.sampleRate;
  return rate && Number.isFinite(rate) ? rate : undefined;
}

async function applyOutputDevice() {
  if (!audioContext || typeof audioContext.setSinkId !== "function") return;
  try {
    await audioContext.setSinkId(outSelect.value || "");
  } catch {
    setStatus("Не удалось переключить устройство вывода", "error");
  }
}

function attachKeepAlive(stream) {
  keepAlive.srcObject = stream;
  keepAlive.muted = true;
  void keepAlive.play().catch(() => {});
}

function detachKeepAlive() {
  keepAlive.pause();
  keepAlive.srcObject = null;
}

function connectPlaybackChain() {
  sourceNode.connect(gainNode);
  gainNode.connect(audioContext.destination);
  gainNode.connect(analyserNode);
}

async function startKaraoke() {
  await stopKaraoke(false);

  mediaStream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
  const sampleRate = getContextSampleRate(mediaStream);

  audioContext = new AudioContext({
    latencyHint: "interactive",
    ...(sampleRate ? { sampleRate } : {}),
  });

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  gainNode = audioContext.createGain();
  updateGain();

  sourceNode.connect(gainNode);
  gainNode.connect(audioContext.destination);

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  attachKeepAlive(mediaStream);

  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 128;
  analyserNode.smoothingTimeConstant = 0;
  gainNode.connect(analyserNode);

  void applyOutputDevice();

  startLevelMeter();
  setKaraokeUi(true);

  if (Number(volumeSlider.value) >= HIGH_GAIN_WARNING_PERCENT) {
    setStatus("Очень высокое усиление — возможны искажения", "active");
  }
}

async function stopKaraoke(updateUi = true) {
  stopLevelMeter();

  try {
    sourceNode?.disconnect();
    gainNode?.disconnect();
    analyserNode?.disconnect();
  } catch {
    /* already disconnected */
  }

  sourceNode = null;
  gainNode = null;
  analyserNode = null;

  detachKeepAlive();

  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;

  const ctx = audioContext;
  audioContext = null;
  if (ctx) void ctx.close();

  if (updateUi) setKaraokeUi(false);
}

async function toggleKaraoke() {
  if (karaokeOn) {
    await stopKaraoke();
  } else {
    try {
      await startKaraoke();
    } catch (err) {
      console.error(err);
      setStatus("Ошибка: не удалось открыть микрофон", "error");
      setKaraokeUi(false);
    }
  }
}

async function onSettingsChange() {
  if (!karaokeOn) return;
  try {
    await startKaraoke();
  } catch (err) {
    console.error(err);
    await stopKaraoke();
    setStatus("Ошибка при смене настроек", "error");
  }
}

volumeSlider.addEventListener("input", () => {
  volumeValue.textContent = `${volumeSlider.value}%`;
  updateGain();
  if (karaokeOn && Number(volumeSlider.value) >= HIGH_GAIN_WARNING_PERCENT) {
    setStatus("Очень высокое усиление — возможны искажения", "active");
  } else if (karaokeOn) {
    updateLatencyStatus();
  }
});

agcToggle.addEventListener("change", onSettingsChange);
nsToggle.addEventListener("change", onSettingsChange);

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  await loadDevices();
  refreshBtn.disabled = false;
  if (permissionGranted && karaokeOn) updateLatencyStatus();
  else if (permissionGranted) setStatus("Караоке выключено");
});

karaokeBtn.addEventListener("click", toggleKaraoke);
micSelect.addEventListener("change", onSettingsChange);
outSelect.addEventListener("change", onSettingsChange);

navigator.mediaDevices.addEventListener("devicechange", () => {
  loadDevices();
});

(async function init() {
  volumeValue.textContent = `${volumeSlider.value}%`;
  const ok = await ensurePermission();
  if (!ok) return;

  await loadDevices();
  karaokeBtn.disabled = micSelect.options.length === 0 || !micSelect.value;
  setStatus("Выберите микрофон и нажмите «Включить караоке»");
})();

// ---------- Обновление программы (GitHub Releases) ----------
const updateBtn = document.getElementById("updateBtn");
const updateLabel = document.getElementById("updateLabel");
const updateStatus = document.getElementById("updateStatus");
const appVersionEl = document.getElementById("appVersion");

let updateAvailable = false;

function setUpdateStatus(text, type = "") {
  updateStatus.hidden = !text;
  updateStatus.textContent = text || "";
  updateStatus.className = "update-status" + (type ? ` ${type}` : "");
}

function formatMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

async function checkUpdates(silent = false) {
  if (!window.updater) return;
  updateBtn.disabled = true;
  updateLabel.textContent = "Проверка…";
  if (!silent) setUpdateStatus("Проверяю обновления…");

  const info = await window.updater.check();
  updateBtn.disabled = false;

  if (info.error) {
    updateAvailable = false;
    updateBtn.classList.remove("available");
    updateLabel.textContent = "Обновить";
    if (!silent) setUpdateStatus(`Не удалось проверить: ${info.error}`, "error");
    return;
  }

  if (info.available) {
    updateAvailable = true;
    updateBtn.classList.add("available");
    updateLabel.textContent = `Обновить до ${info.latest}`;
    setUpdateStatus(`Доступна версия ${info.latest} (${formatMb(info.size)} МБ). Нажмите «Обновить».`, "ok");
  } else {
    updateAvailable = false;
    updateBtn.classList.remove("available");
    updateLabel.textContent = "Обновить";
    if (!silent) setUpdateStatus(`У вас последняя версия (${info.current})`, "ok");
  }
}

async function installUpdate() {
  updateBtn.disabled = true;
  updateLabel.textContent = "Загрузка…";
  setUpdateStatus("Скачиваю обновление…");

  if (karaokeOn) await stopKaraoke();

  const result = await window.updater.install();
  if (result.ok) {
    updateLabel.textContent = "Перезапуск…";
    setUpdateStatus("Готово. Программа перезапустится с новой версией.", "ok");
    return;
  }

  updateBtn.disabled = false;
  updateLabel.textContent = "Обновить";
  setUpdateStatus(result.reason || "Не удалось обновить", "error");
}

if (window.updater) {
  window.updater.version().then((v) => {
    appVersionEl.textContent = v;
  });

  window.updater.onProgress(({ received, total }) => {
    if (total > 0) {
      const pct = Math.round((received / total) * 100);
      updateLabel.textContent = `Загрузка ${pct}%`;
      setUpdateStatus(`Скачиваю обновление: ${formatMb(received)} / ${formatMb(total)} МБ`);
    } else {
      setUpdateStatus(`Скачиваю обновление: ${formatMb(received)} МБ`);
    }
  });

  updateBtn.addEventListener("click", () => {
    if (updateAvailable) installUpdate();
    else checkUpdates(false);
  });

  // Тихая проверка при запуске: подсветим кнопку, если есть новая версия.
  setTimeout(() => checkUpdates(true), 1500);
} else {
  updateBtn.hidden = true;
}
