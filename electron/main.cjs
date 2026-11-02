const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let win;
let activeCapture = null;
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const logPath = path.join(app.getPath('userData'), 'logs', 'recorder.log');

function log(message) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {}
}
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { return { outputDir: path.join(app.getPath('videos'), 'Fenix Recorder'), fps: 30, quality: 'balanced' }; }
}
function writeSettings(value) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(value, null, 2), 'utf8');
}
function getFfmpegPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg.exe') : require('ffmpeg-static');
}
function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 900, minHeight: 650,
    backgroundColor: '#080d18', title: 'Fenix Recorder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:save', (_e, value) => {
    const next = { ...readSettings(), ...value };
    writeSettings(next);
    return next;
  });
  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Папка для записей', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const settings = readSettings(); settings.outputDir = result.filePaths[0]; writeSettings(settings);
    return settings.outputDir;
  });
  ipcMain.handle('folder:open', async () => {
    const dir = readSettings().outputDir || path.join(app.getPath('videos'), 'Fenix Recorder');
    fs.mkdirSync(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
    return dir;
  });

  // Native Windows desktop capture: FFmpeg gdigrab writes MP4 directly.
  // No Chromium getDisplayMedia/getUserMedia video stream is created, so the UI stays rendered.
  ipcMain.handle('record:start', async (_event, options = {}) => {
    if (activeCapture) throw new Error('Запись уже запущена.');
    const settings = readSettings();
    const dir = settings.outputDir || path.join(app.getPath('videos'), 'Fenix Recorder');
    fs.mkdirSync(dir, { recursive: true });
    const safeName = String(options.name || 'Fenix-Recording').replace(/[<>:"/\\|?*]+/g, '_').trim().slice(0, 80) || 'Fenix-Recording';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const output = path.join(dir, `${safeName}-${stamp}.mp4`);
    const fps = Number(options.fps) === 60 ? 60 : 30;
    const quality = ['performance', 'balanced', 'quality'].includes(options.quality) ? options.quality : 'balanced';
    const preset = quality === 'performance' ? 'ultrafast' : quality === 'quality' ? 'faster' : 'veryfast';
    const crf = quality === 'quality' ? '19' : quality === 'performance' ? '26' : '23';
    const ffmpeg = getFfmpegPath();
    if (!ffmpeg || !fs.existsSync(ffmpeg)) throw new Error(`FFmpeg не найден: ${ffmpeg || 'путь пустой'}`);
    const args = [
      '-hide_banner', '-loglevel', 'info', '-y',
      '-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '1', '-i', 'desktop',
      '-an', '-c:v', 'libx264', '-preset', preset, '-crf', crf,
      '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', output
    ];
    log(`START output=${output} fps=${fps} quality=${quality} ffmpeg=${ffmpeg}`);
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    const capture = { child, output, stderr: '', stopping: false, closed: false, closePromise: null };
    capture.closePromise = new Promise(resolve => {
      child.on('close', (code, signal) => {
        capture.closed = true;
        capture.code = code;
        capture.signal = signal;
        log(`CLOSE code=${code} signal=${signal} output=${output} stderr=${capture.stderr.slice(-5000)}`);
        resolve({ code, signal });
        if (activeCapture === capture) {
          activeCapture = null;
          if (win && !win.isDestroyed()) win.webContents.send('record:ended', { code, output });
        }
      });
    });
    child.stderr.on('data', data => {
      const part = data.toString();
      capture.stderr = (capture.stderr + part).slice(-12000);
    });
    const spawned = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(true), 1200);
      child.once('spawn', () => {});
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        reject(new Error(`FFmpeg завершился сразу (код ${code}). ${capture.stderr.slice(-1600)}`));
      });
    }).catch(error => { activeCapture = null; throw error; });
    if (!spawned) throw new Error('Не удалось запустить FFmpeg.');
    if (capture.closed) throw new Error(`FFmpeg остановился. ${capture.stderr.slice(-1600)}`);
    activeCapture = capture;
    return { path: output, fps, started: true };
  });

  ipcMain.handle('record:stop', async () => {
    const capture = activeCapture;
    if (!capture) throw new Error('Сейчас запись не выполняется.');
    if (!capture.stopping && !capture.closed) {
      capture.stopping = true;
      try { capture.child.stdin.write('q\n'); } catch {}
    }
    const result = await Promise.race([
      capture.closePromise,
      new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 15000))
    ]);
    if (result.timeout) {
      try { capture.child.kill(); } catch {}
      throw new Error('FFmpeg не завершил запись за 15 секунд. Проверь журнал recorder.log.');
    }
    if (result.code !== 0 && result.code !== 255) {
      throw new Error(`FFmpeg завершился с кодом ${result.code}. ${capture.stderr.slice(-1800)}`);
    }
    if (!fs.existsSync(capture.output)) throw new Error('Файл MP4 не создан.');
    const size = fs.statSync(capture.output).size;
    if (size < 2048) throw new Error(`Видео получилось пустым (${size} байт). ${capture.stderr.slice(-1200)}`);
    return { path: capture.output, size };
  });

  ipcMain.handle('diagnostics:open-log', async () => {
    if (!fs.existsSync(logPath)) { fs.mkdirSync(path.dirname(logPath), { recursive: true }); fs.writeFileSync(logPath, 'Fenix Recorder log\n'); }
    await shell.openPath(logPath);
    return logPath;
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  if (activeCapture && !activeCapture.closed) {
    try { activeCapture.child.stdin.write('q\n'); } catch {}
  }
});
