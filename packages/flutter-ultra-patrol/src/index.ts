// flutter-ultra-patrol library surface.
//
// Wave 2 / task #11. Exposes 13 tools (plan §17B.1) that orchestrate
// patrol_cli E2E tests. Bundles the Bdaya patrol fork at vendor/patrol/
// via pubspec_overrides; for spawn purposes the fork is consumed through
// `dart run patrol_cli` from the project root.
//
// The executable entry lives in bin.ts — importing this module (vitest
// tests, re-exports) never spawns a stdio transport.

export { SERVER_NAME, SERVER_VERSION, TOOLS, createPatrolServer } from './server.js';
export { readEnv } from './runtime/env.js';
export { JobStore } from './runtime/job-store.js';
export { DevelopSessionManager } from './runtime/develop-session.js';
