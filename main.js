import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import { fetchFile } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

const SUPPORTED_EXTENSIONS = new Set(["mp4", "mov", "m4v", "avi"]);
const LARGE_FILE_300MB = 300 * 1024 ** 2;
const LARGE_FILE_500MB = 500 * 1024 ** 2;
const LARGE_FILE_1GB = 1024 ** 3;
const LARGE_FILE_2GB = 2 * 1024 ** 3;
const HIGH_RESOLUTION_EDGE = 3000;
const SETTINGS_KEY = "videopress-lite-settings";
const THEME_KEY = "videopress-lite-theme";
const FFMPEG_CORE_URL = "/ffmpeg/ffmpeg-core.js";
const FFMPEG_WASM_URL = "/ffmpeg/ffmpeg-core.wasm";
const LIGHT_MODE_SETTINGS = {
  widthMode: "720",
  customWidth: "1280",
  crf: 32,
  preset: "veryfast",
  audio: 64,
};

const state = {
  ffmpeg: null,
  ffmpegLoaded: false,
  file: null,
  metadata: null,
  outputUrl: null,
};

const els = {
  themeToggle: document.querySelector("#themeToggle"),
  themeIcon: document.querySelector("#themeIcon"),
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  warningBox: document.querySelector("#warningBox"),
  errorBox: document.querySelector("#errorBox"),
  toast: document.querySelector("#toast"),
  fileStatus: document.querySelector("#fileStatus"),
  infoName: document.querySelector("#infoName"),
  infoSize: document.querySelector("#infoSize"),
  infoDuration: document.querySelector("#infoDuration"),
  infoResolution: document.querySelector("#infoResolution"),
  infoFps: document.querySelector("#infoFps"),
  settingsForm: document.querySelector("#settingsForm"),
  compressionModeSelect: document.querySelector("#compressionModeSelect"),
  widthSelect: document.querySelector("#widthSelect"),
  customWidthWrap: document.querySelector("#customWidthWrap"),
  customWidth: document.querySelector("#customWidth"),
  crfRange: document.querySelector("#crfRange"),
  crfValue: document.querySelector("#crfValue"),
  presetSelect: document.querySelector("#presetSelect"),
  audioSelect: document.querySelector("#audioSelect"),
  estimateOriginal: document.querySelector("#estimateOriginal"),
  estimateOutput: document.querySelector("#estimateOutput"),
  estimateSaving: document.querySelector("#estimateSaving"),
  compressButton: document.querySelector("#compressButton"),
  runState: document.querySelector("#runState"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  progressBar: document.querySelector("#progressBar"),
  resultPanel: document.querySelector("#resultPanel"),
  resultBefore: document.querySelector("#resultBefore"),
  resultAfter: document.querySelector("#resultAfter"),
  resultSaved: document.querySelector("#resultSaved"),
  resultRate: document.querySelector("#resultRate"),
  resultVideo: document.querySelector("#resultVideo"),
  downloadLink: document.querySelector("#downloadLink"),
};

init();

function init() {
  restoreTheme();
  restoreSettings();
  checkCrossOriginIsolation();
  bindEvents();
  refreshSettingsUi();
}

function bindEvents() {
  els.themeToggle.addEventListener("click", toggleTheme);
  els.fileInput.addEventListener("change", (event) => handleFile(event.target.files?.[0]));
  els.dropZone.addEventListener("click", () => els.fileInput.click());
  els.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("is-dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    handleFile(event.dataTransfer?.files?.[0]);
  });

  els.settingsForm.addEventListener("input", () => {
    applyCompressionMode();
    saveSettings();
    refreshSettingsUi();
    updateEstimate();
  });

  els.compressButton.addEventListener("click", compressVideo);
}

async function handleFile(file) {
  clearMessages();
  resetResult();

  if (!file) return;
  if (!isSupportedFile(file)) {
    showError("非対応形式です。mp4 / mov / m4v / avi の動画を選択してください。");
    return;
  }

  state.file = file;
  setProgress("動画解析中", 8);
  els.fileStatus.textContent = "解析中";

  try {
    state.metadata = await readVideoMetadata(file);
    renderFileInfo();
    renderLargeFileWarning(file);
    updateEstimate();
    els.compressButton.disabled = false;
    els.fileStatus.textContent = "選択済み";
    setProgress("圧縮を開始できます", 0);
  } catch (error) {
    state.file = null;
    state.metadata = null;
    els.compressButton.disabled = true;
    showError("動画の読み込みに失敗しました。ファイルが破損していないか確認してください。");
    setProgress("読み込み失敗", 0);
  }
}

function isSupportedFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return SUPPORTED_EXTENSIONS.has(extension);
}

function readVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    video.onloadedmetadata = () => {
      const metadata = {
        name: file.name,
        size: file.size,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        fps: null,
      };
      URL.revokeObjectURL(url);
      resolve(metadata);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("metadata load failed"));
    };

    video.src = url;
  });
}

function renderFileInfo() {
  const meta = state.metadata;
  els.infoName.textContent = meta.name;
  els.infoSize.textContent = formatBytes(meta.size);
  els.infoDuration.textContent = formatDuration(meta.duration);
  els.infoResolution.textContent = meta.width && meta.height ? `${meta.width} × ${meta.height}` : "取得不可";
  els.infoFps.textContent = meta.fps ? `${meta.fps.toFixed(2)} fps` : "取得不可";
}

function renderLargeFileWarning(file) {
  const warnings = [];

  if (file.size > LARGE_FILE_300MB) {
    warnings.push("300MBを超える動画です。ブラウザ版ではメモリ制限により失敗する可能性があります。");
  }
  if (file.size > LARGE_FILE_500MB) {
    warnings.push("500MBを超える動画です。本格運用ではElectron版またはローカルFFmpeg版を推奨します。");
  }
  if (file.size > LARGE_FILE_2GB) {
    warnings.push("2GBを超える大容量動画です。ブラウザのメモリ制限により処理できない可能性が高いです。");
  } else if (file.size > LARGE_FILE_1GB) {
    warnings.push("1GBを超える大容量動画です。ブラウザのメモリ制限により処理できない可能性があります。");
  }

  if (getMaxVideoEdge(state.metadata) > HIGH_RESOLUTION_EDGE) {
    warnings.push("3000pxを超える高解像度動画です。先に720幅または960幅へ縮小する設定を推奨します。");
  }

  if (warnings.length > 0) {
    showWarning(warnings.join(" "));
  }
}

async function compressVideo() {
  if (!state.file || !state.metadata) return;

  clearMessages();
  resetResult();
  els.compressButton.disabled = true;

  try {
    setProgress("初期化中", 5);
    await ensureFfmpeg();

    const inputName = buildInputName(state.file.name);
    const outputName = "videopress-output.mp4";
    const args = buildFfmpegArgs(inputName, outputName);

    setProgress("動画解析中", 12);
    await state.ffmpeg.writeFile(inputName, await fetchFile(state.file));

    setProgress("圧縮中", 18);
    await state.ffmpeg.exec(args);

    setProgress("出力生成中", 96);
    const data = await state.ffmpeg.readFile(outputName);
    await cleanupFiles(inputName, outputName);

    const outputBlob = new Blob([data.buffer], { type: "video/mp4" });
    showResult(outputBlob);
    setProgress("完了", 100);
    notifyComplete();
  } catch (error) {
    logErrorDetails(error);
    showError(toUserFacingError(error));
    setProgress("圧縮失敗", 0);
  } finally {
    els.compressButton.disabled = !state.file;
  }
}

async function ensureFfmpeg() {
  if (state.ffmpegLoaded) return;

  try {
    state.ffmpeg = new FFmpeg();
    state.ffmpeg.on("progress", ({ progress }) => {
      if (Number.isFinite(progress)) {
        setProgress("圧縮中", Math.min(95, Math.max(18, Math.round(progress * 90))));
      }
    });

    await state.ffmpeg.load({
      coreURL: FFMPEG_CORE_URL,
      wasmURL: FFMPEG_WASM_URL,
    });
    state.ffmpegLoaded = true;
  } catch (error) {
    logErrorDetails(error);
    throw new Error("ffmpeg-init-failed", { cause: error });
  }
}

function buildFfmpegArgs(inputName, outputName) {
  const settings = getSettings();
  const args = ["-i", inputName];
  const width = getEffectiveTargetWidth();

  if (width && shouldApplyScale(width)) {
    args.push("-vf", `scale=${width}:-2`);
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    settings.preset,
    "-crf",
    String(settings.crf),
    "-c:a",
    "aac",
    "-b:a",
    `${settings.audio}k`,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputName,
  );

  return args;
}

function getTargetWidth() {
  const settings = getSettings();
  if (settings.compressionMode === "light") return 720;
  if (settings.widthMode === "original") return null;
  if (settings.widthMode === "custom") return clampEven(Number(settings.customWidth), 320, 4096);
  return Number(settings.widthMode);
}

function getEffectiveTargetWidth() {
  const requestedWidth = getTargetWidth();
  const sourceWidth = state.metadata?.width || 0;
  const sourceMaxEdge = getMaxVideoEdge(state.metadata);

  if (getSettings().compressionMode === "light") return 720;
  if (sourceMaxEdge > HIGH_RESOLUTION_EDGE) {
    if (requestedWidth) return Math.min(requestedWidth, 1920);
    return sourceWidth > 1920 ? 1920 : Math.min(sourceWidth || 960, 960);
  }
  return requestedWidth;
}

function shouldApplyScale(targetWidth) {
  return (
    getSettings().compressionMode === "light" ||
    getMaxVideoEdge(state.metadata) > HIGH_RESOLUTION_EDGE ||
    targetWidth < state.metadata.width
  );
}

function buildInputName(fileName) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "mp4";
  return `input.${extension}`;
}

async function cleanupFiles(...names) {
  await Promise.all(
    names.map(async (name) => {
      try {
        await state.ffmpeg.deleteFile(name);
      } catch {
        // 一時ファイルが存在しないケースは処理結果に影響しない。
      }
    }),
  );
}

function showResult(outputBlob) {
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);

  state.outputUrl = URL.createObjectURL(outputBlob);
  const before = state.file.size;
  const after = outputBlob.size;
  const saved = Math.max(0, before - after);
  const rate = before > 0 ? (saved / before) * 100 : 0;

  els.resultBefore.textContent = formatBytes(before);
  els.resultAfter.textContent = formatBytes(after);
  els.resultSaved.textContent = formatBytes(saved);
  els.resultRate.textContent = `${rate.toFixed(1)}%`;
  els.resultVideo.src = state.outputUrl;
  els.downloadLink.href = state.outputUrl;
  els.downloadLink.download = buildOutputFileName(state.file.name);
  els.resultPanel.classList.remove("hidden");
}

function buildOutputFileName(fileName) {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  return `${baseName}-compressed.mp4`;
}

function updateEstimate() {
  if (!state.file || !state.metadata) {
    els.estimateOriginal.textContent = "-";
    els.estimateOutput.textContent = "-";
    els.estimateSaving.textContent = "-";
    return;
  }

  const estimated = estimateOutputSize();
  const saved = Math.max(0, state.file.size - estimated);
  const rate = state.file.size > 0 ? (saved / state.file.size) * 100 : 0;

  els.estimateOriginal.textContent = formatBytes(state.file.size);
  els.estimateOutput.textContent = formatBytes(estimated);
  els.estimateSaving.textContent = `${rate.toFixed(1)}%`;
}

function estimateOutputSize() {
  const settings = getSettings();
  const meta = state.metadata;
  const duration = Math.max(meta.duration || 1, 1);
  const targetWidth = getEffectiveTargetWidth() || meta.width || 1280;
  const targetHeight = meta.width && meta.height ? Math.round((targetWidth / meta.width) * meta.height) : 720;
  const pixelRatio = Math.min(1, (targetWidth * targetHeight) / Math.max(1, (meta.width || targetWidth) * (meta.height || targetHeight)));
  const crfFactor = Math.pow(2, (28 - settings.crf) / 6);
  const presetFactor = { veryfast: 1.12, fast: 1.05, medium: 1, slow: 0.94 }[settings.preset] || 1;
  const originalVideoMbps = Math.max(0.8, ((state.file.size * 8) / duration / 1_000_000) * 0.85);
  const baselineMbps = Math.min(originalVideoMbps, bitrateForWidth(targetWidth));
  const videoMbps = Math.max(0.45, baselineMbps * pixelRatio * crfFactor * presetFactor);
  const audioMbps = Number(settings.audio) / 1000;
  return Math.round(((videoMbps + audioMbps) * 1_000_000 * duration) / 8);
}

function bitrateForWidth(width) {
  if (width >= 1920) return 7.2;
  if (width >= 1600) return 5.2;
  if (width >= 1280) return 3.4;
  if (width >= 960) return 2.2;
  return 1.35;
}

function refreshSettingsUi() {
  els.crfValue.textContent = els.crfRange.value;
  const lightMode = els.compressionModeSelect.value === "light";
  els.widthSelect.disabled = lightMode;
  els.customWidth.disabled = lightMode;
  els.crfRange.disabled = lightMode;
  els.presetSelect.disabled = lightMode;
  els.audioSelect.disabled = lightMode;
  els.customWidthWrap.classList.toggle("hidden", els.widthSelect.value !== "custom");
}

function getSettings() {
  return {
    compressionMode: els.compressionModeSelect.value,
    widthMode: els.widthSelect.value,
    customWidth: els.customWidth.value,
    crf: Number(els.crfRange.value),
    preset: els.presetSelect.value,
    audio: Number(els.audioSelect.value),
  };
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(getSettings()));
}

function restoreSettings() {
  const saved = safeJsonParse(localStorage.getItem(SETTINGS_KEY));
  if (!saved) return;

  setValueIfExists(els.compressionModeSelect, saved.compressionMode);
  setValueIfExists(els.widthSelect, saved.widthMode);
  setValueIfExists(els.customWidth, saved.customWidth);
  setValueIfExists(els.crfRange, saved.crf);
  setValueIfExists(els.presetSelect, saved.preset);
  setValueIfExists(els.audioSelect, saved.audio);
  applyCompressionMode();
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem(THEME_KEY, nextTheme);
}

function restoreTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeIcon.textContent = theme === "dark" ? "☀" : "☾";
}

function resetResult() {
  if (state.outputUrl) {
    URL.revokeObjectURL(state.outputUrl);
    state.outputUrl = null;
  }
  els.resultPanel.classList.add("hidden");
  els.resultVideo.removeAttribute("src");
}

function setProgress(label, percent) {
  els.progressLabel.textContent = label;
  els.progressPercent.textContent = `${Math.round(percent)}%`;
  els.progressBar.value = Math.round(percent);
  els.runState.textContent = label;
}

function showWarning(message) {
  els.warningBox.textContent = message;
  els.warningBox.classList.remove("hidden");
}

function showError(message) {
  els.errorBox.textContent = message;
  els.errorBox.classList.remove("hidden");
}

function clearMessages() {
  els.warningBox.classList.add("hidden");
  els.errorBox.classList.add("hidden");
  els.warningBox.textContent = "";
  els.errorBox.textContent = "";
}

function checkCrossOriginIsolation() {
  console.log("crossOriginIsolated:", window.crossOriginIsolated);
  if (!window.crossOriginIsolated) {
    showError("ブラウザのcross-origin isolationが有効ではありません。");
  }
}

function logErrorDetails(error) {
  console.error(error);
  console.error(error?.cause);
  console.error(error?.stack);
}

function notifyComplete() {
  showToast("圧縮が完了しました。");
  if (!("Notification" in window)) return;

  if (Notification.permission === "granted") {
    new Notification("VideoPress Lite", { body: "圧縮が完了しました。" });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification("VideoPress Lite", { body: "圧縮が完了しました。" });
      }
    });
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.setTimeout(() => els.toast.classList.add("hidden"), 4200);
}

function toUserFacingError(error) {
  const text = `${error?.message || ""} ${error?.cause?.message || ""}`.toLowerCase();
  if (
    text.includes("memory") ||
    text.includes("allocation") ||
    text.includes("out of bounds") ||
    text.includes("abort") ||
    text.includes("aborted") ||
    text.includes("runtimeerror")
  ) {
    return "動画が大きすぎるため、ブラウザ版では処理できません。720幅・CRF32・veryfastで再試行してください。";
  }
  if (text.includes("ffmpeg-init-failed")) {
    return "ffmpegの初期化に失敗しました。ネットワーク接続、ブラウザ設定、またはCDNへのアクセスを確認してください。";
  }
  return "圧縮に失敗しました。形式、容量、ブラウザのメモリ制限を確認してください。";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "取得不可";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function clampEven(value, min, max) {
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return clamped % 2 === 0 ? clamped : clamped - 1;
}

function applyCompressionMode() {
  if (els.compressionModeSelect.value !== "light") return;

  els.widthSelect.value = LIGHT_MODE_SETTINGS.widthMode;
  els.customWidth.value = LIGHT_MODE_SETTINGS.customWidth;
  els.crfRange.value = String(LIGHT_MODE_SETTINGS.crf);
  els.presetSelect.value = LIGHT_MODE_SETTINGS.preset;
  els.audioSelect.value = String(LIGHT_MODE_SETTINGS.audio);
}

function getMaxVideoEdge(metadata) {
  return Math.max(metadata?.width || 0, metadata?.height || 0);
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function setValueIfExists(element, value) {
  if (value === undefined || value === null) return;
  element.value = String(value);
}
