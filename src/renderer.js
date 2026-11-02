const $ = id => document.getElementById(id);
let settings = null;
let recording = false;
let startedAt = 0;
let timerId = null;
let activeOutput = '';

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 5000);
}
function setState(title, subtitle, active = false) {
  $('recordState').textContent = title;
  $('recordSub').textContent = subtitle;
  $('stateIcon').style.color = active ? '#ff6479' : '#7ac9ff';
}
function updateGain() { $('micGainOut').textContent = `${$('micGain').value}%`; }
$('micGain').addEventListener('input', updateGain);

async function refreshAudioDevices() {
  const micSelect = $('micDevice');
  const sysSelect = $('systemDevice');
  const oldMic = micSelect.value;
  const oldSystem = sysSelect.value;
  micSelect.innerHTML = '<option value="">Не выбрано</option>';
  sysSelect.innerHTML = '<option value="">Не выбрано</option>';
  const devices = await window.fenix.listAudioDevices();
  for (const name of devices) {
    const a = document.createElement('option'); a.value = name; a.textContent = name; micSelect.appendChild(a);
    const b = document.createElement('option'); b.value = name; b.textContent = name; sysSelect.appendChild(b);
  }
  if (devices.includes(oldMic)) micSelect.value = oldMic;
  else {
    const mic = devices.find(x => /microphone|mic|микрофон|headset|гарнитур/i.test(x));
    if (mic) micSelect.value = mic;
  }
  if (devices.includes(oldSystem)) sysSelect.value = oldSystem;
  else {
    const system = devices.find(x => /stereo mix|стерео микшер|what u hear|wave out|loopback/i.test(x));
    if (system) sysSelect.value = system;
  }
  $('audioDeviceStatus').textContent = devices.length ? `Найдено устройств: ${devices.length}` : 'FFmpeg не обнаружил DirectShow-устройства. Проверь подключение и разрешения микрофона Windows.';
  if (!micSelect.value) $('micEnabled').checked = false;
  if (!sysSelect.value) $('systemEnabled').checked = false;
  return devices;
}
async function init() {
  settings = await window.fenix.getSettings();
  $('outputPath').textContent = settings.outputDir;
  $('fps').value = String(settings.recorderVersion === 3 ? (settings.fps || 30) : 30);
  $('quality').value = settings.quality || 'balanced';
  await window.fenix.saveSettings({ fps: Number($('fps').value), quality: $('quality').value, recorderVersion: 3 });
  try { await refreshAudioDevices(); }
  catch (e) { $('audioDeviceStatus').textContent = `Ошибка поиска аудио: ${e.message}`; }
}
async function saveSettings() {
  settings = await window.fenix.saveSettings({ fps: Number($('fps').value), quality: $('quality').value });
}
$('fps').addEventListener('change', () => saveSettings().catch(e => toast(e.message)));
$('quality').addEventListener('change', () => saveSettings().catch(e => toast(e.message)));
$('chooseFolder').addEventListener('click', async () => {
  try {
    const folder = await window.fenix.chooseFolder();
    if (folder) { $('outputPath').textContent = folder; toast('Папка сохранения обновлена.'); }
  } catch (e) { toast(e.message); }
});
async function openFolder() {
  try { await window.fenix.openFolder(); } catch (e) { toast(e.message); }
}
$('openFolder').addEventListener('click', openFolder);
$('openFolderSide').addEventListener('click', openFolder);
function startClock() {
  startedAt = Date.now();
  clearInterval(timerId);
  timerId = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    $('recordSub').textContent = `Идёт запись · ${mm}:${ss} · ${$('fps').value} FPS`;
  }, 500);
}
function resetButton() {
  recording = false;
  clearInterval(timerId);
  $('recordBtn').disabled = false;
  $('recordBtn').classList.remove('recording');
  $('recordBtn').innerHTML = '<span class="btn-rec-dot"></span> НАЧАТЬ ЗАПИСЬ';
}
async function startRecording() {
  await saveSettings();
  $('recordBtn').disabled = true;
  setState('Запускаем захват', 'Подключаем FFmpeg к рабочему столу…');
  const result = await window.fenix.startRecording({
    name: $('recordName').value || 'Fenix-Recording',
    fps: Number($('fps').value),
    quality: $('quality').value,
    micEnabled: $('micEnabled').checked,
    systemEnabled: $('systemEnabled').checked,
    micDevice: $('micDevice').value,
    systemDevice: $('systemDevice').value,
    micGain: Number($('micGain').value)
  });
  activeOutput = result.path;
  recording = true;
  $('recordBtn').disabled = false;
  $('recordBtn').classList.add('recording');
  $('recordBtn').innerHTML = '<span class="btn-rec-dot"></span> ОСТАНОВИТЬ ЗАПИСЬ';
  setState('Идёт запись', `Файл: ${activeOutput}`, true);
  startClock();
  toast(result.audioWarning || 'Запись экрана началась. Окно Fenix Recorder остаётся доступным.');
}
async function stopRecording() {
  if (!recording) return;
  recording = false;
  clearInterval(timerId);
  $('recordBtn').disabled = true;
  $('recordBtn').textContent = 'СОХРАНЕНИЕ MP4…';
  setState('Завершаем запись', 'FFmpeg закрывает MP4 и сохраняет индекс видео…');
  try {
    const result = await window.fenix.stopRecording();
    setState('Запись сохранена', result.path);
    toast(`Видео сохранено (${(result.size / 1024 / 1024).toFixed(1)} МБ): ${result.path}`);
  } catch (e) {
    setState('Ошибка сохранения', e.message || 'Неизвестная ошибка');
    toast(e.message || 'Не удалось сохранить запись.');
  } finally {
    resetButton();
  }
}
$('recordBtn').addEventListener('click', async () => {
  if (recording) return stopRecording();
  try { await startRecording(); }
  catch (e) {
    resetButton();
    setState('Готов к записи', 'Не удалось запустить захват. Открой журнал ошибок.');
    toast(e.message || 'Не удалось начать запись.');
  }
});
$('recordBtn').insertAdjacentHTML('afterend', '<button class="btn btn-secondary" id="openLogBtn" type="button">Журнал ошибок</button>');
$('openLogBtn').addEventListener('click', async () => {
  try { await window.fenix.openLog(); } catch (e) { toast(e.message); }
});

$('refreshAudio').addEventListener('click', async () => {
  $('refreshAudio').disabled = true;
  $('audioDeviceStatus').textContent = 'Поиск аудиоустройств…';
  try { const devices = await refreshAudioDevices(); toast(`Обнаружено аудиоустройств: ${devices.length}`); }
  catch (e) { $('audioDeviceStatus').textContent = e.message; toast(e.message); }
  finally { $('refreshAudio').disabled = false; }
});
$('testMic').addEventListener('click', async () => {
  const device = $('micDevice').value;
  if (!device) { toast('Сначала выбери микрофон. Если список пустой — нажми «Обновить устройства».'); return; }
  $('testMic').disabled = true; $('testMic').textContent = 'ЗАПИСЫВАЕМ 4 СЕКУНДЫ…';
  try { const file = await window.fenix.testMic(device); toast(`Тест микрофона сохранён: ${file}`); }
  catch (e) { toast(e.message); }
  finally { $('testMic').disabled = false; $('testMic').textContent = 'Проверить микрофон (4 сек.)'; }
});
window.fenix.onRecordingEnded(data => {
  if (!recording) return;
  resetButton();
  setState('Запись остановлена', `Код FFmpeg: ${data.code}. Файл: ${data.output}`);
  toast('Процесс записи завершился. Проверь сохранённый MP4.');
});
init().catch(e => toast('Не удалось загрузить настройки: ' + e.message));
