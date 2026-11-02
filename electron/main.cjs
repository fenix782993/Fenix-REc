const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

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
  catch { return { outputDir: path.join(app.getPath('videos'), 'Fenix Recorder'), fps: 30, quality: 'balanced', recorderVersion: 3 }; }
}
function writeSettings(value) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(value, null, 2), 'utf8');
}
function getFfmpegPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg.exe') : require('ffmpeg-static');
}
async function listDshowAudioDevices() {
  const ffmpeg = getFfmpegPath();
  let output = '';
  try {
    const result = await execFileAsync(ffmpeg, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    output = `${result.stderr || ''}\n${result.stdout || ''}`;
  } catch (e) {
    output = `${e.stderr || ''}\n${e.stdout || ''}`;
  }
  const names = [];
  for (const line of output.split(/\r?\n/)) {
    if (/Alternative name/i.test(line) || !/\(audio\)/i.test(line)) continue;
    const match = line.match(/"([^"]+)"\s*\(audio\)/i) || line.match(/"([^"]+)"/);
    if (match && match[1] && !match[1].startsWith('@') && !names.includes(match[1])) names.push(match[1]);
  }
  log(`AUDIO_ENUM raw=${output.slice(-7000).replace(/\r?\n/g, ' | ')} parsed=${JSON.stringify(names)}`);
  return names;
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
  ipcMain.handle('audio:list-devices', async () => listDshowAudioDevices());
  ipcMain.handle('audio:test-mic', async (_event, deviceName) => {
    const devices = await listDshowAudioDevices();
    if (!deviceName || !devices.includes(deviceName)) throw new Error('Выбери доступный микрофон из списка.');
    const dir = readSettings().outputDir || app.getPath('videos');
    fs.mkdirSync(dir, { recursive: true });
    const output = path.join(dir, `Fenix-Mic-Test-${Date.now()}.wav`);
    const ffmpeg = getFfmpegPath();
    await new Promise((resolve, reject) => {
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-thread_queue_size', '512', '-f', 'dshow', '-i', `audio=${deviceName}`, '-t', '4', '-vn', '-ac', '2', '-ar', '48000', output];
      const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = ''; child.stderr.on('data', d => stderr = (stderr + d.toString()).slice(-4000));
      child.once('error', reject);
      child.once('close', code => code === 0 && fs.existsSync(output) && fs.statSync(output).size > 1000 ? resolve() : reject(new Error(`Не удалось записать тест микрофона: ${stderr || `код ${code}`}`)));
    });
    const error = await shell.openPath(output); if (error) throw new Error(error);
    return output;
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
    const devices = await listDshowAudioDevices();
    const wantMic = options.micEnabled !== false;
    const wantSystem = options.systemEnabled !== false;
    const micDevice = String(options.micDevice || '');
    const systemDevice = String(options.systemDevice || '');
    const micGain = Math.max(0.5, Math.min(2, Number(options.micGain || 100) / 100));
    const requestedAudio = [];
    if (wantSystem && systemDevice && devices.includes(systemDevice)) requestedAudio.push({ kind: 'system', device: systemDevice });
    if (wantMic && micDevice && devices.includes(micDevice)) requestedAudio.push({ kind: 'mic', device: micDevice });
    const audioPlans = [];
    if (requestedAudio.length) audioPlans.push(requestedAudio);
    // A missing/busy Stereo Mix must never prevent the microphone or video from recording.
    const micOnly = requestedAudio.filter(x => x.kind === 'mic');
    if (micOnly.length && !audioPlans.some(p => p.length === 1 && p[0].kind === 'mic')) audioPlans.push(micOnly);
    audioPlans.push([]);
    const videoInputs = [
      ['ddagrab', ['-f', 'lavfi', '-i', `ddagrab=framerate=${fps}:draw_mouse=1`]],
      ['gdigrab', ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '1', '-i', 'desktop']]
    ];
    const encoders = await execFileAsync(ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 }).then(x => x.stdout + x.stderr).catch(e => `${e.stdout || ''}\n${e.stderr || ''}`);
    const videoEncoders = [];
    if (/\bh264_amf\b/.test(encoders)) videoEncoders.push({ name: 'h264_amf', args: ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', quality === 'quality' ? '22' : '25', '-qp_p', quality === 'quality' ? '24' : '27'] });
    videoEncoders.push({ name: 'libx264', args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', quality === 'quality' ? '22' : quality === 'performance' ? '27' : '25'] });
    const makeArgs = (videoInput, audioItems, encoder) => {
      const args = ['-hide_banner', '-loglevel', 'info', '-y', '-thread_queue_size', '1024', ...videoInput];
      for (const item of audioItems) args.push('-thread_queue_size', '512', '-f', 'dshow', '-i', `audio=${item.device}`);
      args.push('-map', '0:v:0');
      if (audioItems.length === 2) {
        const sysIndex = 1 + audioItems.findIndex(x => x.kind === 'system');
        const micIndex = 1 + audioItems.findIndex(x => x.kind === 'mic');
        args.push('-filter_complex', `[${sysIndex}:a]aresample=async=1:first_pts=0[sys];[${micIndex}:a]volume=${micGain},aresample=async=1:first_pts=0[mic];[sys][mic]amix=inputs=2:duration=longest:dropout_transition=2[aout]`, '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
      } else if (audioItems.length === 1) {
        args.push('-filter_complex', `[1:a]${audioItems[0].kind === 'mic' ? `volume=${micGain},` : ''}aresample=async=1:first_pts=0[aout]`, '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
      } else args.push('-an');
      args.push(...encoder.args, '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-movflags', '+faststart', output);
      return args;
    };
    log(`START output=${output} fps=${fps} quality=${quality} requestedAudio=${JSON.stringify(requestedAudio)} availableDevices=${JSON.stringify(devices)} ffmpeg=${ffmpeg}`);
    let child;
    let selectedEngine = '';
    let selectedEncoder = '';
    let selectedAudio = [];
    let startupError = null;
    outer: for (const audioItems of audioPlans) {
      for (const [engine, videoInput] of videoInputs) {
        for (const encoder of videoEncoders) {
          child = spawn(ffmpeg, makeArgs(videoInput, audioItems, encoder), { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
          const startup = await new Promise(resolve => {
            let stderr = ''; let settled = false;
            const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ ok: true, stderr }); } }, 2500);
            child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-8000); });
            child.once('error', error => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: false, stderr, error }); } });
            child.once('close', code => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ok: false, code, stderr }); } });
          });
          if (startup.ok) { selectedEngine = engine; selectedEncoder = encoder.name; selectedAudio = audioItems; break outer; }
          startupError = startup;
          log(`ENGINE_START_FAILED engine=${engine} encoder=${encoder.name} audio=${JSON.stringify(audioItems)} code=${startup.code} error=${startup.error || ''} stderr=${startup.stderr}`);
          if (child && !child.killed) { try { child.kill(); } catch {} }
        }
      }
    }
    if (!selectedEngine) throw new Error(`Не удалось запустить захват экрана. ${startupError?.stderr || startupError?.error || ''}`);
    log(`ENGINE_SELECTED ${selectedEngine} encoder=${selectedEncoder} audio=${JSON.stringify(selectedAudio)}`);
    const capture = { child, output, stderr: '', stopping: false, closed: false, closePromise: null, engine: selectedEngine };
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
    if (capture.closed) throw new Error(`FFmpeg остановился. ${capture.stderr.slice(-1600)}`);
    activeCapture = capture;
    return { path: output, fps, started: true, engine: selectedEngine, encoder: selectedEncoder, audio: selectedAudio.length > 0, audioDevices: devices, audioWarning: (wantMic && !selectedAudio.some(x => x.kind === 'mic') ? 'Микрофон не записывается: проверь выбор устройства и разрешение Windows. ' : '') + (wantSystem && !selectedAudio.some(x => x.kind === 'system') ? 'Звук игры не подключён: выбери Stereo Mix, если он доступен. ' : '') + (selectedAudio.length === 0 && (wantMic || wantSystem) ? 'Видео записывается без звука.' : '') };
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
