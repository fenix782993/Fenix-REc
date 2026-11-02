const $ = id => document.getElementById(id);
let settings, recording = false, recorder, chunks = [], micStream, displayStream, mixedStream, audioContext, micAnalyser, meterTimer, startedAt, finishing = false;
function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3800);
}
function setState(title, subtitle, active = false) {
  $('recordState').textContent = title; $('recordSub').textContent = subtitle;
  $('stateIcon').style.color = active ? '#ff6479' : '#7ac9ff';
}
function updateGain() { $('micGainOut').textContent = `${$('micGain').value}%`; }
$('micGain').addEventListener('input', updateGain);
async function init() {
  settings = await window.fenix.getSettings();
  $('outputPath').textContent = settings.outputDir;
  $('fps').value = String(settings.fps || 30);
  $('quality').value = settings.quality || 'balanced';
  await window.fenix.saveSettings({ fps: Number($('fps').value), quality: $('quality').value });
}
async function saveSettings() {
  settings = await window.fenix.saveSettings({ fps: Number($('fps').value), quality: $('quality').value });
}
$('fps').addEventListener('change', saveSettings);
$('quality').addEventListener('change', saveSettings);
$('chooseFolder').addEventListener('click', async () => {
  const folder = await window.fenix.chooseFolder();
  if (folder) { $('outputPath').textContent = folder; toast('Папка сохранения обновлена.'); }
});
async function openFolder() { await window.fenix.openFolder(); }
$('openFolder').addEventListener('click', openFolder);
$('openFolderSide').addEventListener('click', openFolder);
$('testMic').addEventListener('click', async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(s);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    toast('Микрофон работает. Говори — индикатор покажет уровень сигнала.');
    const start = Date.now();
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (const v of data) { const n = (v - 128) / 128; sum += n*n; }
      $('micMeter').style.width = `${Math.min(100, Math.sqrt(sum/data.length)*250)}%`;
      if (Date.now() - start < 8000) requestAnimationFrame(loop);
      else { s.getTracks().forEach(t => t.stop()); ctx.close(); $('micMeter').style.width = '0%'; }
    }; loop();
  } catch (e) { toast('Не удалось открыть микрофон. Проверь разрешения Windows и подключение устройства.'); }
});
function makeAudioGraph(display, mic) {
  audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  if ($('systemEnabled').checked && display.getAudioTracks().length) {
    const sysSource = audioContext.createMediaStreamSource(new MediaStream(display.getAudioTracks()));
    const sysGain = audioContext.createGain(); sysGain.gain.value = 1;
    sysSource.connect(sysGain).connect(destination);
  }
  if ($('micEnabled').checked && mic && mic.getAudioTracks().length) {
    const micSource = audioContext.createMediaStreamSource(mic);
    const gain = audioContext.createGain(); gain.gain.value = Number($('micGain').value) / 100;
    micAnalyser = audioContext.createAnalyser(); micAnalyser.fftSize = 256;
    micSource.connect(gain); gain.connect(destination); gain.connect(micAnalyser);
    const data = new Uint8Array(micAnalyser.frequencyBinCount);
    const meterLoop = () => {
      if (!recording || !micAnalyser) return;
      micAnalyser.getByteTimeDomainData(data);
      let sum = 0; for (const v of data) { const n = (v - 128) / 128; sum += n*n; }
      $('micMeter').style.width = `${Math.min(100, Math.sqrt(sum/data.length)*250)}%`;
      meterTimer = requestAnimationFrame(meterLoop);
    }; meterLoop();
  }
  return destination.stream;
}
async function waitForVideoFrame(stream) {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  video.style.position = 'fixed'; video.style.left = '-9999px'; video.style.width = '2px'; video.style.height = '2px';
  document.body.appendChild(video);
  try {
    await video.play();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Не поступают кадры с выбранного экрана. Повтори выбор окна/монитора.')), 8000);
      const done = () => { clearTimeout(timeout); resolve(); };
      if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(done);
      else if (video.videoWidth > 0 && video.videoHeight > 0) done();
      else video.addEventListener('loadeddata', done, { once: true });
    });
    if (!video.videoWidth || !video.videoHeight) throw new Error('Захват экрана не передал изображение.');
  } finally { video.pause(); video.srcObject = null; video.remove(); }
}
function chooseMime() {
  for (const mime of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}
async function startRecording() {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Захват экрана не поддерживается этой системой.');
  const fps = Number($('fps').value);
  displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps, max: fps }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: $('systemEnabled').checked
  });
  const videoTracks = displayStream.getVideoTracks().filter(t => t.readyState === 'live');
  if (!videoTracks.length) throw new Error('Windows не предоставила видеопоток. Повтори выбор экрана.');
  await waitForVideoFrame(displayStream);
  micStream = null;
  if ($('micEnabled').checked) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false });
    } catch (e) {
      displayStream.getTracks().forEach(t => t.stop());
      throw new Error('Не удалось открыть микрофон. Проверь устройство и разрешения Windows.');
    }
  }
  const audio = makeAudioGraph(displayStream, micStream);
  mixedStream = new MediaStream([...videoTracks, ...audio.getAudioTracks()]);
  chunks = []; finishing = false;
  const mimeType = chooseMime();
  const options = { videoBitsPerSecond: $('quality').value === 'performance' ? 2500000 : $('quality').value === 'quality' ? 8000000 : 4500000 };
  if (mimeType) options.mimeType = mimeType;
  recorder = new MediaRecorder(mixedStream, options);
  recorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onerror = e => {
    const msg = e.error?.message || 'неизвестная ошибка MediaRecorder';
    toast(`Ошибка записи: ${msg}`);
  };
  videoTracks[0].addEventListener('ended', () => { if (recording) stopRecording(); }, { once: true });
  await new Promise((resolve, reject) => {
    recorder.addEventListener('start', resolve, { once: true });
    recorder.addEventListener('error', e => reject(e.error || new Error('MediaRecorder не смог начать запись')), { once: true });
    try { recorder.start(1000); } catch (e) { reject(e); }
  });
  recording = true; startedAt = Date.now();
  $('recordBtn').classList.add('recording'); $('recordBtn').innerHTML = '<span class="btn-rec-dot"></span> ОСТАНОВИТЬ ЗАПИСЬ';
  setState('Идёт запись', `Запись ${fps} FPS · не закрывай программу`, true);
}
async function stopRecording() {
  if (!recording || finishing) return;
  recording = false; finishing = true;
  cancelAnimationFrame(meterTimer);
  $('recordBtn').disabled = true;
  $('recordBtn').textContent = 'СОХРАНЕНИЕ...';
  setState('Сохраняем видео', 'Завершаем запись и проверяем видеопоток');
  try {
    if (recorder && recorder.state !== 'inactive') {
      // Flush the last buffered fragment before stopping. The final dataavailable
      // event is delivered before the stop event according to MediaRecorder spec.
      try { recorder.requestData(); } catch {}
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Тайм-аут завершения записи. Попробуй записать короткий ролик ещё раз.')), 15000);
        recorder.addEventListener('stop', () => { clearTimeout(timer); resolve(); }, { once: true });
        recorder.addEventListener('error', e => { clearTimeout(timer); reject(e.error || new Error('Ошибка MediaRecorder')); }, { once: true });
        try { recorder.stop(); } catch (e) { clearTimeout(timer); reject(e); }
      });
    }
    await finishRecording();
  } catch (e) {
    setState('Не удалось сохранить', e.message || 'Неизвестная ошибка');
    toast(e.message || 'Ошибка сохранения');
  } finally {
    [displayStream, micStream, mixedStream].filter(Boolean).forEach(s => s.getTracks().forEach(t => t.stop()));
    if (audioContext) { try { await audioContext.close(); } catch {} }
    displayStream = micStream = mixedStream = null; recorder = null; chunks = []; micAnalyser = null; finishing = false;
    $('recordBtn').disabled = false; $('recordBtn').classList.remove('recording');
    $('recordBtn').innerHTML = '<span class="btn-rec-dot"></span> НАЧАТЬ ЗАПИСЬ';
    $('micMeter').style.width = '0%';
  }
}
async function finishRecording() {
  const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });
  if (blob.size < 1024) throw new Error(`Запись не содержит видео (получено ${blob.size} байт из ${chunks.length} фрагментов). Проверь выбор экрана и повтори запись.`);
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать видеозапись'));
    reader.readAsDataURL(blob);
  });
  setState('Сохраняем исходник', `Получено ${(blob.size / 1024 / 1024).toFixed(2)} МБ видео`);
  const saved = await window.fenix.saveRecording({ base64, name: $('recordName').value || 'Fenix-Recording' });
  setState('Проверяем и конвертируем', 'Создаём совместимый MP4 H.264');
  const converted = await window.fenix.convertRecording(saved.path);
  setState('Запись сохранена', converted.path);
  toast(`Видео сохранено: ${converted.path}`);
}
$('recordBtn').addEventListener('click', async () => {
  if (recording) return stopRecording();
  try { await saveSettings(); await startRecording(); }
  catch (e) { toast(e.message || 'Не удалось начать запись.'); setState('Готов к записи', 'Проверь настройки микрофона и разрешения.'); }
});
window.addEventListener('beforeunload', e => { if (recording) { e.preventDefault(); e.returnValue = ''; } });
init().catch(e => toast('Не удалось загрузить настройки: ' + e.message));