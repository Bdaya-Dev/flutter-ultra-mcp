---
name: record-demo
description: Records a video or GIF demo of a Flutter app flow. Detects platform (web browser or native device), starts recording, drives the UI interaction, stops recording, then converts to the requested format (MP4, WebM, or GIF). Use when the user asks to record a demo, capture a flow as video, or produce an animated GIF of app behavior.
---

# Record Demo

Orchestrates platform detection → start recording → drive flow → stop recording → convert format.

## Workflow

### 1. Detect platform

Determine recording method based on the running target:

- **Web** — use `mcp__plugin_flutter_flutter-ultra-browser__new_context` with `recordVideo.dir` set to a local output directory. Playwright records all pages automatically; video is saved on `mcp__plugin_flutter_flutter-ultra-browser__close_context`.
- **Android device** — use `mcp__plugin_flutter_flutter-ultra-native-mobile__start_device_recording` with an `outputPath` ending in `.mp4`.
- **iOS Simulator** — use `mcp__plugin_flutter_flutter-ultra-native-mobile__start_device_recording` with an `outputPath` ending in `.mp4`.

Discover running sessions first:

```
mcp__plugin_flutter_flutter-ultra-runtime__discover_sessions
```

Check `device.kind` in the response: `'web'` → browser path, `'android'` / `'ios-sim'` → native path.

### 2. Start recording

#### Web (Playwright recordVideo)

```
mcp__plugin_flutter_flutter-ultra-browser__new_context
  browserId: <id>
  recordVideo:
    dir: /tmp/flutter-demo-recordings
    size:          # optional — omit to use viewport size
      width: 1280
      height: 800
```

Returns `contextId` and `recordingDir`. Then open a tab and navigate to the app URL.

#### Native device (Android / iOS)

```
mcp__plugin_flutter_flutter-ultra-native-mobile__start_device_recording
  deviceId: <udid>
  outputPath: /tmp/flutter-demo.mp4
  maxDurationSec: 60
```

Returns `recordingId`. Keep it for the stop call.

### 3. Drive the UI flow

Use the appropriate tools to exercise the flow being recorded:

- **Runtime** — `mcp__plugin_flutter_flutter-ultra-runtime__hot_reload`, `mcp__plugin_flutter_flutter-ultra-runtime__evaluate`, `mcp__plugin_flutter_flutter-ultra-runtime__find_widget`
- **Browser** — `mcp__plugin_flutter_flutter-ultra-browser__click`, `mcp__plugin_flutter_flutter-ultra-browser__fill`, `mcp__plugin_flutter_flutter-ultra-browser__navigate`
- **Native** — `mcp__plugin_flutter_flutter-ultra-native-mobile__native_tap`, `mcp__plugin_flutter_flutter-ultra-native-mobile__native_type`, `mcp__plugin_flutter_flutter-ultra-native-mobile__native_swipe`

For responsive demos, resize the viewport between key interactions:

- Mobile: 390×844
- Tablet: 768×1024
- Desktop: 1440×900

Take screenshots at key moments for verification alongside the recording.

### 4. Stop recording

#### Web

```
mcp__plugin_flutter_flutter-ultra-browser__close_context
  contextId: <id>
```

Returns `videoPath` — the `.webm` file Playwright wrote to `recordingDir`.

#### Native device

```
mcp__plugin_flutter_flutter-ultra-native-mobile__stop_device_recording
  recordingId: <id>
```

Returns `path` and `durationMs`.

### 5. Convert to target format

Use `mcp__plugin_flutter_flutter-ultra-build__convert_recording` to convert to the user's desired format:

#### High-quality GIF (for sharing in docs / GitHub)

```
mcp__plugin_flutter_flutter-ultra-build__convert_recording
  inputPath: /tmp/flutter-demo.mp4
  outputPath: /tmp/flutter-demo.gif
  outputFormat: gif
  maxWidth: 800
  fps: 12
```

#### Compressed MP4 (for embedding in web pages)

```
mcp__plugin_flutter_flutter-ultra-build__convert_recording
  inputPath: /tmp/flutter-demo.webm
  outputPath: /tmp/flutter-demo.mp4
  outputFormat: mp4
  maxWidth: 1280
  quality: 23
```

#### WebM (smallest size, web-native)

```
mcp__plugin_flutter_flutter-ultra-build__convert_recording
  inputPath: /tmp/flutter-demo.mp4
  outputPath: /tmp/flutter-demo.webm
  outputFormat: webm
  quality: 30
```

### 6. Report result

Return the output file path, size in bytes, and format. Suggest next steps:

- Embed GIF in README with `![demo](./flutter-demo.gif)`
- Upload MP4 as a GitHub release asset
- Use WebM in `<video>` tags on web landing pages

## Notes

- ffmpeg must be installed for `convert_recording`. If not found, the tool returns a clear installation hint.
- Android `screenrecord` has a 180-second hard limit. For longer demos, restart recording in segments.
- iOS Simulator recording requires macOS with Xcode installed.
- Playwright writes `.webm` by default; pass it directly to `convert_recording` for format changes.
- For CanvasKit Flutter web, ensure semantics are enabled before driving UI with browser tools.
