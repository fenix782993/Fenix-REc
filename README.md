# Fenix Recorder 0.2.1

Windows screen recorder built with Electron and FFmpeg.

## Build on Windows

Requirements: Node.js 20+ and Windows x64.

```powershell
npm.cmd install
npm.cmd install-scripts approve ffmpeg-static electron
npm.cmd rebuild ffmpeg-static
npm.cmd run dist
```

Installer: `dist/Fenix-Recorder-Setup-0.2.1.exe`.

## Recording notes

- Screen capture waits for the first actual video frame before starting MediaRecorder.
- MediaRecorder chunks are collected and flushed before the final save.
- Very small or invalid WebM data is rejected instead of being reported as a successful recording.
- Original WebM files are retained after MP4 conversion for troubleshooting/recovery.
- MP4 export uses H.264 video, AAC audio and fast-start metadata.

## Troubleshooting

If Windows capture permission is denied, close other screen-capture applications and restart Fenix Recorder. Select a monitor/window in the Windows capture picker. For a first test, record for at least 5 seconds.
