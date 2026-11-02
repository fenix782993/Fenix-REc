const { app, BrowserWindow, ipcMain, dialog, shell, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let win;
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { return { outputDir: path.join(app.getPath('videos'), 'Fenix Recorder'), fps: 30, quality: 'balanced' }; }
}
function writeSettings(value) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(value, null, 2), 'utf8');
}
function ffmpegPath() {
  const bin = app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg.exe') : require('ffmpeg-static');
  if (!bin || !fs.existsSync(bin)) throw new Error(`FFmpeg не найден: ${bin || 'путь пустой'}`);
  return bin;
}
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-10000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg завершился с кодом ${code}: ${stderr.slice(-1800)}`)));
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 900, minHeight: 650,
    backgroundColor: '#080d18',
    title: 'Fenix Recorder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}
app.whenReady().then(() => {
  // Permit Chromium's native display picker to request desktop video and loopback audio.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
      const screen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      callback(screen ? { video: screen, audio: 'loopback' } : {});
    } catch { callback({}); }
  }, { useSystemPicker: true });
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:save', (_e, value) => {
    const old = readSettings();
    const next = { ...old, ...value };
    writeSettings(next);
    return next;
  });
  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Папка для записей', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const settings = readSettings();
    settings.outputDir = result.filePaths[0];
    writeSettings(settings);
    return settings.outputDir;
  });
  ipcMain.handle('folder:open', async () => {
    const dir = readSettings().outputDir;
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return dir;
  });
  ipcMain.handle('record:save', async (_e, payload) => {
    const settings = readSettings();
    const dir = settings.outputDir || path.join(app.getPath('videos'), 'Fenix Recorder');
    fs.mkdirSync(dir, { recursive: true });
    const safeName = String(payload.name || 'Fenix-Recording').replace(/[<>:"/\\|?*]+/g, '_').slice(0, 80);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dir, `${safeName}-${stamp}.webm`);
    fs.writeFileSync(target, Buffer.from(payload.base64, 'base64'));
    return { path: target, dir };
  });
  ipcMain.handle('record:convert', async (_e, inputPath) => {
    if (typeof inputPath !== 'string' || !fs.existsSync(inputPath)) throw new Error('Исходный видеофайл не найден.');
    const outputPath = inputPath.replace(/\.webm$/i, '') + '-converted.mp4';
    await runFfmpeg(['-hide_banner','-y','-i',inputPath,'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-max_muxing_queue_size','2048',outputPath]);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 2048) throw new Error('FFmpeg создал пустой или слишком маленький MP4.');
    return { path: outputPath };
  });
  ipcMain.handle('video:open', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Выбери видео для обрезки', properties: ['openFile'], filters: [{ name: 'Видео', extensions: ['mp4','webm','mkv','mov'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('video:trim', async (_e, payload) => {
    const input = payload?.path;
    const start = Number(payload?.start);
    const end = Number(payload?.end);
    if (typeof input !== 'string' || !fs.existsSync(input)) throw new Error('Видео не найдено.');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('Проверь начало и конец фрагмента.');
    const ext = path.extname(input) || '.mp4';
    const output = path.join(path.dirname(input), `${path.basename(input, ext)}-cut-${Date.now()}.mp4`);
    await runFfmpeg(['-hide_banner','-y','-ss',String(start),'-i',input,'-t',String(end-start),'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',output]);
    if (!fs.existsSync(output) || fs.statSync(output).size < 2048) throw new Error('Не удалось создать обрезанный файл.');
    return { path: output };
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
