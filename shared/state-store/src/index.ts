// @flutter-ultra/state-store — file-based IPC for cross-server shared state.
//
// Plan §4 IPC strategy: JSON files under ${CLAUDE_PLUGIN_DATA}/state/, atomic
// read-modify-write via proper-lockfile, change notifications via chokidar.
//
// Will export: stateRead, stateWrite, stateWatch, appendJsonl.

export const PACKAGE_NAME = '@flutter-ultra/state-store';
