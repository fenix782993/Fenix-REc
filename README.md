# Fenix Recorder

Fenix Recorder is a Windows desktop screen recorder built with Electron. It captures the desktop, microphone and (where supported by Windows/Electron) system loopback audio. Recordings are kept as WebM originals and exported to MP4 with FFmpeg. The built-in editor can trim a selected video and export the cut as a new MP4 without modifying the source.

## Requirements
- Windows 10/11 x64
- Node.js 22 LTS
- Microphone permission in Windows settings

## Run locally
```powershell
npm install
npm start
```

## Build installer locally
```powershell
npm install
npm run dist
```
Installer will be in `dist/`.

## Build on GitHub
1. Create a repository named `Fenix-Recorder` on GitHub.
2. Upload/push all project files to the `main` branch.
3. Open **Actions** and enable workflows if GitHub asks.
4. Run **Build Fenix Recorder for Windows** with **Run workflow**.
5. Download `Fenix-Recorder-Windows-Installer` from the completed workflow's **Artifacts** section.
6. To publish a public release, create and push a version tag, for example:
   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```
   The workflow will attach the installer to the GitHub Release.

## Audio notes
- Microphone is captured separately and mixed into the recording.
- System/game audio depends on Windows loopback capture support and the display-capture picker. When choosing what to share, enable system audio if the picker exposes that option.
- If a game uses exclusive fullscreen or protected capture, switch it to borderless/windowed mode or record the full display.
- Capture records WebM first. FFmpeg exports a separate H.264/AAC MP4; the original WebM is retained. The editor opens MP4/WebM/MKV/MOV files and exports a selected time range as a separate MP4.
- This first build uses Chromium desktop capture, not a native DirectX Desktop Duplication pipeline. It is a functional starting point, but performance and audio routing must be tested on the target PC. No recorder can guarantee zero FPS loss on every hardware setup.

## Editing
- Open a video from the Montage section.
- Set start and end time in seconds.
- Export the selected range to a new MP4 in the same folder.
- The original file is never overwritten.

## Quality presets
- Performance: lower video bitrate
- Balanced: default bitrate
- High quality: higher bitrate
