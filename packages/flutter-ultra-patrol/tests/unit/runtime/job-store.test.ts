import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { JobStore } from '../../../src/runtime/job-store.js';

const nodeCmd = process.execPath;

describe('JobStore', () => {
  it('starts in pending and moves to running on attachChild', () => {
    const store = new JobStore();
    const rec = store.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    expect(rec.status).toBe('pending');
    // Attach a noop short-lived child.
    const child = spawn(nodeCmd, ['-e', '"process.exit(0);"'], { shell: true });
    store.attachChild(rec.id, child);
    expect(rec.status).toBe('running');
  });

  it('marks status=completed on successful exit', async () => {
    const store = new JobStore();
    const rec = store.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    const child = spawn(nodeCmd, ['-e', 'process.exit(0);']);
    store.attachChild(rec.id, child);
    await waitForExit(rec.id, store);
    expect(rec.status).toBe('completed');
    expect(rec.exitCode).toBe(0);
    expect(rec.endedAt).not.toBeNull();
  });

  it('marks status=failed on non-zero exit', async () => {
    const store = new JobStore();
    const rec = store.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    const child = spawn(nodeCmd, ['-e', 'process.exit(7);']);
    store.attachChild(rec.id, child);
    await waitForExit(rec.id, store);
    expect(rec.status).toBe('failed');
    expect(rec.exitCode).toBe(7);
  });

  it('captures stdout/stderr into rolling tail (line-split)', async () => {
    const store = new JobStore();
    const rec = store.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    const script = `process.stdout.write("hello\\nworld\\n"); process.stderr.write("warn\\n"); process.exit(0);`;
    const child = spawn(nodeCmd, ['-e', script]);
    store.attachChild(rec.id, child);
    await waitForExit(rec.id, store);
    const texts = rec.logTail.map((l) => `${l.stream}:${l.text}`);
    expect(texts).toContain('stdout:hello');
    expect(texts).toContain('stdout:world');
    expect(texts).toContain('stderr:warn');
    expect(rec.logTotal).toBeGreaterThanOrEqual(3);
  });

  it('respects logTailLimit ring buffer', async () => {
    const store = new JobStore({ logTailLimit: 5 });
    const rec = store.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    const script = `for (let i=0;i<20;i++) console.log("L"+i); process.exit(0);`;
    const child = spawn(nodeCmd, ['-e', script]);
    store.attachChild(rec.id, child);
    await waitForExit(rec.id, store);
    expect(rec.logTail.length).toBe(5);
    expect(rec.logTotal).toBe(20);
    expect(rec.logTail.at(-1)?.text).toBe('L19');
  });

  it('cancel() flips status to cancelled and kills the child', async () => {
    const store = new JobStore();
    const rec = store.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    const child = spawn(nodeCmd, ['-e', `setTimeout(() => process.exit(0), 60_000);`]);
    store.attachChild(rec.id, child);
    const ok = store.cancel(rec.id, 250);
    expect(ok).toBe(true);
    await waitForExit(rec.id, store);
    expect(rec.status).toBe('cancelled');
    expect(rec.endedAt).not.toBeNull();
  });

  it('prune drops jobs whose endedAt < cutoff', async () => {
    const store = new JobStore();
    const rec = store.create({
      kind: 'test',
      command: 'noop',
      args: [],
      cwd: '/x',
      wrapperScript: null,
      envSnapshot: {},
    });
    const child = spawn(nodeCmd, ['-e', 'process.exit(0);']);
    store.attachChild(rec.id, child);
    await waitForExit(rec.id, store);
    const dropped = store.prune(Date.now() + 1_000);
    expect(dropped).toBe(1);
    expect(store.get(rec.id)).toBeUndefined();
  });
});

async function waitForExit(id: string, store: JobStore, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      const rec = store.get(id);
      if (rec && rec.endedAt !== null) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`waitForExit timed out for job ${id}`));
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}
