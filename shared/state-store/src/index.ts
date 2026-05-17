// Public surface of @flutter-ultra/state-store.
//
// File-based IPC: lock-guarded JSON CRUD + append-only JSONL streams.

export {
  appendJsonl,
  readJsonl,
  stateRead,
  stateRelative,
  stateUpdate,
  stateWriteAtomic,
  type JsonlReadResult,
  type StateUpdateOptions,
} from './store.js';

export {
  jobFilePath,
  jobsDir,
  locksDir,
  pluginDataDir,
  sessionsFilePath,
  stateDir,
  streamFilePath,
  streamsDir,
} from './paths.js';
