// flutter-ultra-gesture library surface.
//
// Tools call `ext.flutter.ultra.*` service extensions in a running Flutter
// app, addressed by the runtime server's `sessions.json`. The executable
// entry lives in bin.ts — importing this module never starts a server.

export const SERVER_NAME = 'flutter-ultra-gesture';

export { createGestureServer } from './server.js';
