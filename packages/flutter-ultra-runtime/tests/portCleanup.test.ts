import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { findListenersOnPort, freePort } from '../src/portCleanup.js';

function listenOnEphemeralPort(): Promise<{
  server: ReturnType<typeof createServer>;
  port: number;
}> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
    server.on('error', reject);
  });
}

describe('findListenersOnPort', () => {
  it('finds a process listening on a specific port', async () => {
    const { server, port } = await listenOnEphemeralPort();
    try {
      const holders = await findListenersOnPort(port);
      expect(holders.length).toBeGreaterThanOrEqual(1);
      expect(holders[0]!.pid).toBe(process.pid);
    } finally {
      server.close();
    }
  });

  it('returns empty array for an unused port', async () => {
    // Bind then immediately close to get a port that's definitely free.
    const { server, port } = await listenOnEphemeralPort();
    server.close();
    await new Promise((r) => setTimeout(r, 100));

    const holders = await findListenersOnPort(port);
    expect(holders).toEqual([]);
  });
});

describe('freePort', () => {
  it('kills a process holding the port and frees it', async () => {
    // We can't kill ourselves (that would abort the test), so instead
    // spawn a child that holds the port and verify freePort kills it.
    const { spawn } = await import('node:child_process');

    // Spawn a node child that binds a TCP server and stays alive.
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
        const net = require('net');
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => {
          process.stdout.write(String(s.address().port));
        });
        // Stay alive indefinitely.
        setInterval(() => {}, 60000);
        `,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );

    // Read the port from stdout.
    const port = await new Promise<number>((resolve, reject) => {
      let buf = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const n = parseInt(buf, 10);
        if (!isNaN(n) && n > 0) resolve(n);
      });
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error(`child exited early: ${code}`)));
    });

    // Verify the port is occupied.
    const before = await findListenersOnPort(port);
    expect(before.length).toBeGreaterThanOrEqual(1);

    // Free the port.
    const logs: string[] = [];
    const killed = await freePort(port, (msg) => logs.push(msg));
    expect(killed.length).toBeGreaterThanOrEqual(1);
    expect(killed).toContain(child.pid);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]).toMatch(/killing orphan process/);

    // Verify the port is now free.
    const after = await findListenersOnPort(port);
    expect(after).toEqual([]);
  }, 10_000);

  it('returns empty array when port is already free', async () => {
    const { server, port } = await listenOnEphemeralPort();
    server.close();
    await new Promise((r) => setTimeout(r, 100));

    const killed = await freePort(port);
    expect(killed).toEqual([]);
  });
});
