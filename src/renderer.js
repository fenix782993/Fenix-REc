const $ = id => document.getElementById(id);
let settings, recording = false, recorder, chunks = [], micStream, displayStream, mixedStream, audioContext, micAnalyser, meterTimer, startedAt, editPath = null;
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
$('openVideo').addEventListener('click', async () => {
  try {
    const path = await window.fenix.openVideo();
    if (!path) return;
    editPath = path;
    const video = $('editPreview');
    video.src = `file:///${path.replace(/\\/g, '/')}`;
    $('editFileName').textContent = path.split(/[\\/]/).pop();
    $('trimBtn').disabled = false;
    $('trimEnd').value = '0';
  } catch (e) { toast(e.message || 'Не удалось открыть видео.'); }
});
$('editPreview').addEventListener('loadedmetadata', () => {
  $('trimEnd').value = Number.isFinite($('editPreview').duration) ? $('editPreview').duration.toFixed(1) : '0';
  $('trimStart').max = $('editPreview').duration;
  $('trimEnd').max = $('editPreview').duration;
});
$('trimBtn').addEventListener('click', async () => {
  if (!editPath) return;
  const start = Number($('trimStart').value), end = Number($('trimEnd').value);
  if (!(end > start)) return toast('Время конца должно быть больше времени начала.');
  $('trimBtn').disabled = true; $('trimBtn').textContent = 'ОБРАБОТКА...';
  try {
    const result = await window.fenix.trimVideo({ path: editPath, start, end });
    toast(`Обрезанный файл сохранён: ${result.path}`);
  } catch (e) { toast(e.message || 'Ошибка обрезки видео.'); }
  finally { $('trimBtn').disabled = false; $('trimBtn').textContent = 'СОХРАНИТЬ ОБРЕЗАННЫЙ ФРАГМЕНТ'; }
});
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
    video: { frameRate: { ideal: fps, max: fps }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: $('systemEnabled').checked
  });
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
  mixedStream = new MediaStream([...displayStream.getVideoTracks(), ...audio.getAudioTracks()]);
  chunks = [];
  const mimeType = chooseMime();
  recorder = new MediaRecorder(mixedStream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: $('quality').value === 'performance' ? 2500000 : $('quality').value === 'quality' ? 8000000 : 4500000 });
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onerror = e => toast(`Ошибка записи: ${e.error?.message || 'неизвестная ошибка'}`);
  recorder.onstop = finishRecording;
  displayStream.getVideoTracks()[0].addEventListener('ended', () => { if (recording) stopRecording(); });
  recorder.start(1000);
  recording = true; startedAt = Date.now();
  $('recordBtn').classList.add('recording'); $('recordBtn').innerHTML = '<span class="btn-rec-dot"></span> ОСТАНОВИТЬ ЗАПИСЬ';
  setState('Идёт запись', `Запись ${fps} FPS · не закрывай программу`, true);
}
async function stopRecording() {
  if (!recording) return;
  recording = false;
  cancelAnimationFrame(meterTimer);
  $('recordBtn').disabled = true;
  $('recordBtn').textContent = 'СОХРАНЕНИЕ...';
  setState('Сохраняем видео', 'Не закрывай программу, идёт обработка файла');
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}
async function finishRecording() {
  try {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
    if (!blob.size) throw new Error('Видео пустое. Попробуй повторить запись.');
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
    });
    const saved = await window.fenix.saveRecording({ base64, name: $('recordName').value || 'Fenix-Recording' });
    let finalPath = saved.path;
    setState('Конвертируем в MP4', 'Почти готово — обрабатываем видео и звук');
    try {
      const converted = await window.fenix.convertRecording(saved.path);
      finalPath = converted.path;
    } catch (e) {
      toast('MP4 не удалось создать. Исходный WebM сохранён: ' + e.message.slice(0, 180));
    }
    setState('Запись сохранена', finalPath);
    toast(`Видео сохранено: ${finalPath}`);
  } catch (e) {
    setState('Не удалось сохранить', e.message || 'Неизвестная ошибка');
    toast(e.message || 'Ошибка сохранения');
  } finally {
    [displayStream, micStream, mixedStream].filter(Boolean).forEach(s => s.getTracks().forEach(t => t.stop()));
    if (audioContext) { try { await audioContext.close(); } catch {} }
    displayStream = micStream = mixedStream = null; recorder = null; chunks = [];
    $('recordBtn').disabled = false; $('recordBtn').classList.remove('recording');
    $('recordBtn').innerHTML = '<span class="btn-rec-dot"></span> НАЧАТЬ ЗАПИСЬ';
    $('micMeter').style.width = '0%';
  }
}
$('recordBtn').addEventListener('click', async () => {
  if (recording) return stopRecording();
  try { await saveSettings(); await startRecording(); }
  catch (e) { toast(e.message || 'Не удалось начать запись.'); setState('Готов к записи', 'Проверь настройки микрофона и разрешения.'); }
});
window.addEventListener('beforeunload', e => { if (recording) { e.preventDefault(); e.returnValue = ''; } });
init().catch(e => toast('Не удалось загрузить настройки: ' + e.message));