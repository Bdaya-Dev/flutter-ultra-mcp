import { describe, expect, it, afterEach } from 'vitest';
import { DevelopSessionManager } from '../../../src/runtime/develop-session.js';
import { CdpConsoleCapture } from '../../../src/runtime/cdp-console-capture.js';
import type { PatrolJobRecord } from '../../../src/runtime/job-store.js';

function makeRecord(overrides: Partial<PatrolJobRecord> = {}): PatrolJobRecord {
  const writes: string[] = [];
  const fakeStdin = {
    destroyed: false,
    write(chunk: string): boolean {
      writes.push(chunk);
      return true;
    },
  };
  const child = {
    stdin: fakeStdin,
    pid: 1234,
    killed: false,
  } as unknown as PatrolJobRecord['child'];
  return {
    id: 'job-1',
    kind: 'develop',
    status: 'running',
    command: 'dart',
    args: ['run', 'patrol_cli', 'develop'],
    cwd: '/x',
    wrapperScript: null,
    envSnapshot: {},
    startedAt: 0,
    endedAt: null,
    exitCode: null,
    errorMessage: null,
    logTail: [],
    logTotal: 0,
    child,
    ...overrides,
  } satisfies PatrolJobRecord;
}

describe('DevelopSessionManager', () => {
  it('starts empty', () => {
    expect(new DevelopSessionManager().get()).toBeNull();
  });

  it('registers a session and exposes it via get()', () => {
    const m = new DevelopSessionManager();
    const rec = makeRecord();
    m.register(rec);
    expect(m.get()?.id).toBe('job-1');
  });

  it('refuses a second concurrent register', () => {
    const m = new DevelopSessionManager();
    m.register(makeRecord());
    expect(() => m.register(makeRecord({ id: 'job-2' }))).toThrow(/already active/);
  });

  it('send() writes newline-terminated command to stdin', () => {
    const m = new DevelopSessionManager();
    const rec = makeRecord();
    m.register(rec);
    const writes: string[] = [];
    rec.child!.stdin!.write = (chunk: string) => {
      writes.push(chunk);
      return true;
    };
    expect(m.send('r')).toBe(true);
    expect(writes).toEqual(['r\n']);
  });

  it('send() returns false when stdin is destroyed', () => {
    const m = new DevelopSessionManager();
    const rec = makeRecord();
    (rec.child!.stdin as unknown as { destroyed: boolean }).destroyed = true;
    m.register(rec);
    expect(m.send('r')).toBe(false);
  });

  it('clear() drops the session', () => {
    const m = new DevelopSessionManager();
    m.register(makeRecord());
    m.clear();
    expect(m.get()).toBeNull();
  });

  it('get() returns null after the child detached itself', () => {
    const m = new DevelopSessionManager();
    const rec = makeRecord();
    m.register(rec);
    rec.child = null;
    expect(m.get()).toBeNull();
  });

  it('lastTestFile and lastRecordingPath start as null', () => {
    const m = new DevelopSessionManager();
    expect(m.lastTestFile).toBeNull();
    expect(m.lastRecordingPath).toBeNull();
  });

  it('setTestFile stores and retrieves lastTestFile', () => {
    const m = new DevelopSessionManager();
    m.setTestFile('login_test.dart');
    expect(m.lastTestFile).toBe('login_test.dart');
  });

  it('setRecordingPath stores and retrieves lastRecordingPath', () => {
    const m = new DevelopSessionManager();
    m.setRecordingPath('/tmp/recording.gif');
    expect(m.lastRecordingPath).toBe('/tmp/recording.gif');
  });

  it('clear() resets lastTestFile and lastRecordingPath', () => {
    const m = new DevelopSessionManager();
    m.register(makeRecord());
    m.setTestFile('login_test.dart');
    m.setRecordingPath('/tmp/recording.gif');
    m.clear();
    expect(m.lastTestFile).toBeNull();
    expect(m.lastRecordingPath).toBeNull();
    expect(m.get()).toBeNull();
  });

  it('register() resets lastTestFile and lastRecordingPath', () => {
    const m = new DevelopSessionManager();
    m.setTestFile('old_test.dart');
    m.setRecordingPath('/tmp/old_recording.gif');
    // clear() the old session so register() doesn't throw "already active"
    m.clear();
    m.register(makeRecord());
    expect(m.lastTestFile).toBeNull();
    expect(m.lastRecordingPath).toBeNull();
  });

  it('cdpErrors returns empty array when no capture started', () => {
    const m = new DevelopSessionManager();
    expect(m.cdpErrors).toEqual([]);
  });

  it('startCdpCapture stores capture and cdpErrors returns them', async () => {
    const m = new DevelopSessionManager();
    // Inject a mock CdpConsoleCapture via the public API by monkey-patching
    // the prototype's connect to avoid needing a real WebSocket server.
    const fakeErrors = [
      { ts: 100, level: 'error' as const, message: 'boom', source: 'cdp' as const },
    ];
    const origConnect = CdpConsoleCapture.prototype.connect;
    CdpConsoleCapture.prototype.connect = async function () {
      // Simulate populating errors by directly pushing into the internal array
      // via the public getter pattern -- we use Object.defineProperty instead.
      Object.defineProperty(this, 'capturedErrors', { get: () => fakeErrors });
    };
    try {
      await m.startCdpCapture(9999);
      expect(m.cdpErrors).toHaveLength(1);
      expect(m.cdpErrors[0]).toMatchObject({ message: 'boom', source: 'cdp' });
    } finally {
      CdpConsoleCapture.prototype.connect = origConnect;
    }
  });

  it('clear() disconnects CDP capture', () => {
    const m = new DevelopSessionManager();
    let disconnected = false;
    // Manually wire a mock capture via startCdpCapture's internal field
    const mockCapture = {
      disconnect() { disconnected = true; },
      capturedErrors: [],
    } as unknown as CdpConsoleCapture;
    // Access private field to inject mock
    (m as unknown as { cdpCapture: CdpConsoleCapture | null }).cdpCapture = mockCapture;
    expect(m.cdpErrors).toEqual([]);

    m.clear();
    expect(disconnected).toBe(true);
    expect(m.cdpErrors).toEqual([]);
  });

  it('register() disconnects existing CDP capture', () => {
    const m = new DevelopSessionManager();
    let disconnected = false;
    const mockCapture = {
      disconnect() { disconnected = true; },
      capturedErrors: [],
    } as unknown as CdpConsoleCapture;
    (m as unknown as { cdpCapture: CdpConsoleCapture | null }).cdpCapture = mockCapture;

    m.register(makeRecord());
    expect(disconnected).toBe(true);
    // After register, cdpCapture is nulled out
    expect(m.cdpErrors).toEqual([]);
  });
});
