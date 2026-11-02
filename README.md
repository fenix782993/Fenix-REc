# Fenix Recorder 0.3.0

Windows 10/11 x64 screen recorder. The 0.3.0 capture engine uses FFmpeg `gdigrab` directly from Electron's main process and writes MP4 directly. It does not create a Chromium video capture stream, so the app UI is not replaced by a blue/blank capture surface.

## Requirements
- Windows 10/11 x64
- Node.js 20 or 22 LTS

## Run
```powershell
npm.cmd install
npm.cmd start
```

## Build installer
```powershell
npm.cmd install
npm.cmd run dist
```
Installer is written to `dist/Fenix-Recorder-Setup-0.3.0.exe`.

## Capture notes
- Video capture uses FFmpeg's Windows `gdigrab` input and saves MP4 directly.
- The recorder window remains visible and controllable while recording. It will also appear in the captured desktop if left on screen; minimize it if you do not want it in the recording.
- This rebuild temporarily disables microphone and system-audio controls. Video capture reliability is being isolated first; the UI explicitly says audio is not included.
- Exclusive-fullscreen games may not be captured by GDI. Use borderless/windowed mode or record the desktop.
- Error log: `%APPDATA%\fenix-recorder\logs\recorder.log` (Electron userData directory may vary by Windows profile/app identity).
