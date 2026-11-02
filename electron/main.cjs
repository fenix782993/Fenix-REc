const { app, BrowserWindow, ipcMain, dialog, shell, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
    if (!payload || typeof payload.base64 !== 'string' || payload.base64.length < 1400) {
      throw new Error('Видеоданные пустые или слишком маленькие. Запись не сохранена.');
    }
    const buffer = Buffer.from(payload.base64, 'base64');
    if (buffer.length < 1024 || buffer.subarray(0, 4).toString('hex') !== '1a45dfa3') {
      throw new Error(`Некорректный WebM: ${buffer.length} байт. Повреждённый файл не будет сохранён.`);
    }
    const target = path.join(dir, `${safeName}-${stamp}.webm`);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, target);
    return { path: target, dir, bytes: buffer.length };
  });
  ipcMain.handle('record:convert', async (_e, inputPath) => {
    const ffmpegPath = app.isPackaged
      ? path.join(process.resourcesPath, 'ffmpeg.exe')
      : require('ffmpeg-static');
    if (!fs.existsSync(inputPath) || fs.statSync(inputPath).size < 1024) throw new Error('Исходный WebM отсутствует или повреждён.');
    const outputPath = inputPath.replace(/\.webm$/i, '.mp4');
    const { spawn } = require('child_process');
    return await new Promise((resolve, reject) => {
      const args = ['-y', '-i', inputPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outputPath];
      const child = spawn(ffmpegPath, args, { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', code => {
        if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
          resolve({ path: outputPath });
        } else reject(new Error(`FFmpeg conversion failed (${code}). ${stderr.slice(-1200)}`));
      });
    });
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
