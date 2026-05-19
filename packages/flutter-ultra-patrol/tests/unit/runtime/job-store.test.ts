import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

// ──────────────────────────────────────────────────────
// Persistence tests (AC-JOB2-JOB4)
// ──────────────────────────────────────────────────────

function tmpStateDir(): string {
  return join(tmpdir(), `job-store-test-${randomUUID()}`);
}

describe('JobStore — file persistence', () => {
  it('create() writes a job file to {stateDir}/jobs/{id}.json', async () => {
    const stateDir = tmpStateDir();
    try {
      const store = new JobStore({ stateDir });
      const rec = store.create({
        kind: 'test',
        command: 'dart',
        args: ['run'],
        cwd: '/project',
        wrapperScript: null,
        envSnapshot: { FOO: 'bar' },
      });
      // Give the fire-and-forget write time to land.
      await waitMs(100);
      const filePath = join(stateDir, 'jobs', `${rec.id}.json`);
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed['id']).toBe(rec.id);
      expect(parsed['kind']).toBe('test');
      expect(parsed['status']).toBe('pending');
      expect(parsed['command']).toBe('dart');
      expect(parsed['envSnapshot']).toEqual({ FOO: 'bar' });
      // Ephemeral fields must NOT be persisted.
      expect(parsed['logTail']).toBeUndefined();
      expect(parsed['child']).toBeUndefined();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('exit handler updates status + endedAt in the file', async () => {
    const stateDir = tmpStateDir();
    try {
      const store = new JobStore({ stateDir });
      const rec = store.create({
        kind: 'test',
        command: nodeCmd,
        args: ['-e', 'process.exit(0);'],
        cwd: '/project',
        wrapperScript: null,
        envSnapshot: {},
      });
      const child = spawn(nodeCmd, ['-e', 'process.exit(0);']);
      store.attachChild(rec.id, child);
      await waitForExit(rec.id, store);
      await waitMs(100);
      const filePath = join(stateDir, 'jobs', `${rec.id}.json`);
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
      expect(parsed['status']).toBe('completed');
      expect(parsed['exitCode']).toBe(0);
      expect(typeof parsed['endedAt']).toBe('number');
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('cancel() updates status to cancelled in the file', async () => {
    const stateDir = tmpStateDir();
    try {
      const store = new JobStore({ stateDir });
      const rec = store.create({
        kind: 'test',
        command: nodeCmd,
        args: ['-e', 'setTimeout(()=>{},60000)'],
        cwd: '/project',
        wrapperScript: null,
        envSnapshot: {},
      });
      const child = spawn(nodeCmd, ['-e', 'setTimeout(()=>{},60000)']);
      store.attachChild(rec.id, child);
      store.cancel(rec.id, 250);
      await waitForExit(rec.id, store);
      await waitMs(100);
      const filePath = join(stateDir, 'jobs', `${rec.id}.json`);
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
      expect(parsed['status']).toBe('cancelled');
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('recover() loads terminal jobs as-is from disk', async () => {
    const stateDir = tmpStateDir();
    try {
      // First store: run a job to completion.
      const store1 = new JobStore({ stateDir });
      const rec = store1.create({
        kind: 'test',
        command: nodeCmd,
        args: ['-e', 'process.exit(0);'],
        cwd: '/project',
        wrapperScript: null,
        envSnapshot: {},
      });
      const child = spawn(nodeCmd, ['-e', 'process.exit(0);']);
      store1.attachChild(rec.id, child);
      await waitForExit(rec.id, store1);
      await waitMs(100);

      // Second store (simulates restart): recover from disk.
      const store2 = new JobStore({ stateDir });
      const recovered = await store2.recover();
      expect(recovered.length).toBe(1);
      const r = store2.get(rec.id);
      expect(r).toBeDefined();
      expect(r!.status).toBe('completed');
      expect(r!.exitCode).toBe(0);
      expect(r!.kind).toBe('test');
      expect(r!.child).toBeNull();
      expect(r!.logTail).toEqual([]);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('recover() marks non-terminal jobs as crashed', async () => {
    const stateDir = tmpStateDir();
    try {
      // Write a fake "running" job file directly.
      const { mkdir: mkdirFs, writeFile: writeFileFs } = await import('node:fs/promises');
      const jobsDir = join(stateDir, 'jobs');
      await mkdirFs(jobsDir, { recursive: true });
      const fakeId = randomUUID();
      const fakeRecord = {
        id: fakeId,
        kind: 'test',
        status: 'running',
        command: 'dart',
        args: [],
        cwd: '/project',
        wrapperScript: null,
        envSnapshot: {},
        startedAt: Date.now() - 5000,
        endedAt: null,
        exitCode: null,
        errorMessage: null,
      };
      await writeFileFs(join(jobsDir, `${fakeId}.json`), JSON.stringify(fakeRecord), 'utf8');

      const store = new JobStore({ stateDir });
      const recovered = await store.recover();
      expect(recovered.length).toBe(1);
      const r = store.get(fakeId);
      expect(r!.status).toBe('crashed');
      expect(r!.exitCode).toBe(-1);
      expect(r!.endedAt).not.toBeNull();
      expect(r!.errorMessage).toContain('restarted');
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('prune() deletes the state file', async () => {
    const stateDir = tmpStateDir();
    try {
      const store = new JobStore({ stateDir });
      const rec = store.create({
        kind: 'test',
        command: nodeCmd,
        args: ['-e', 'process.exit(0);'],
        cwd: '/project',
        wrapperScript: null,
        envSnapshot: {},
      });
      const child = spawn(nodeCmd, ['-e', 'process.exit(0);']);
      store.attachChild(rec.id, child);
      await waitForExit(rec.id, store);
      await waitMs(100);

      const filePath = join(stateDir, 'jobs', `${rec.id}.json`);
      // File should exist before prune.
      await readFile(filePath, 'utf8');

      store.prune(Date.now() + 1_000);
      await waitMs(100);

      // File should be gone after prune.
      await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(store.get(rec.id)).toBeUndefined();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('recover() is a no-op when stateDir is not configured', async () => {
    const store = new JobStore();
    const recovered = await store.recover();
    expect(recovered).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

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

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
