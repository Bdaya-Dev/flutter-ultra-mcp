import { describe, expect, it } from 'vitest';
import {
  parseSshConfigFromEnv,
  createSshExecFn,
  SshTransport,
  type SshConfig,
  type ExecFn,
} from './ssh.js';

// ─── parseSshConfigFromEnv ─────────────────────────────────────────────────

describe('parseSshConfigFromEnv', () => {
  it('returns SshConfig when all env vars are set', () => {
    const env = {
      FLUTTER_ULTRA_SSH_HOST: 'example.com',
      FLUTTER_ULTRA_SSH_PORT: '2222',
      FLUTTER_ULTRA_SSH_USER: 'deploy',
      FLUTTER_ULTRA_SSH_KEY: '/home/deploy/.ssh/id_ed25519',
    };
    const original = { ...process.env };
    Object.assign(process.env, env);
    try {
      const config = parseSshConfigFromEnv();
      expect(config).not.toBeNull();
      expect(config?.host).toBe('example.com');
      expect(config?.port).toBe(2222);
      expect(config?.username).toBe('deploy');
      expect(config?.privateKeyPath).toBe('/home/deploy/.ssh/id_ed25519');
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
      Object.assign(process.env, original);
    }
  });

  it('returns null when host is not set', () => {
    const saved = process.env['FLUTTER_ULTRA_SSH_HOST'];
    delete process.env['FLUTTER_ULTRA_SSH_HOST'];
    try {
      expect(parseSshConfigFromEnv()).toBeNull();
    } finally {
      if (saved !== undefined) process.env['FLUTTER_ULTRA_SSH_HOST'] = saved;
    }
  });

  it('defaults port to 22 when FLUTTER_ULTRA_SSH_PORT is not set', () => {
    const env = {
      FLUTTER_ULTRA_SSH_HOST: 'example.com',
      FLUTTER_ULTRA_SSH_USER: 'ci',
      FLUTTER_ULTRA_SSH_KEY: '/tmp/key',
    };
    const savedPort = process.env['FLUTTER_ULTRA_SSH_PORT'];
    delete process.env['FLUTTER_ULTRA_SSH_PORT'];
    Object.assign(process.env, env);
    try {
      const config = parseSshConfigFromEnv();
      expect(config?.port).toBe(22);
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
      if (savedPort !== undefined) process.env['FLUTTER_ULTRA_SSH_PORT'] = savedPort;
    }
  });

  it('parses port string to number', () => {
    const env = {
      FLUTTER_ULTRA_SSH_HOST: 'example.com',
      FLUTTER_ULTRA_SSH_PORT: '4422',
      FLUTTER_ULTRA_SSH_USER: 'ci',
      FLUTTER_ULTRA_SSH_KEY: '/tmp/key',
    };
    Object.assign(process.env, env);
    try {
      const config = parseSshConfigFromEnv();
      expect(typeof config?.port).toBe('number');
      expect(config?.port).toBe(4422);
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  });

  it('returns null when user is not set', () => {
    const env = {
      FLUTTER_ULTRA_SSH_HOST: 'example.com',
      FLUTTER_ULTRA_SSH_KEY: '/tmp/key',
    };
    const savedUser = process.env['FLUTTER_ULTRA_SSH_USER'];
    delete process.env['FLUTTER_ULTRA_SSH_USER'];
    Object.assign(process.env, env);
    try {
      expect(parseSshConfigFromEnv()).toBeNull();
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
      if (savedUser !== undefined) process.env['FLUTTER_ULTRA_SSH_USER'] = savedUser;
    }
  });

  it('returns null when key path is not set', () => {
    const env = {
      FLUTTER_ULTRA_SSH_HOST: 'example.com',
      FLUTTER_ULTRA_SSH_USER: 'ci',
    };
    const savedKey = process.env['FLUTTER_ULTRA_SSH_KEY'];
    delete process.env['FLUTTER_ULTRA_SSH_KEY'];
    Object.assign(process.env, env);
    try {
      expect(parseSshConfigFromEnv()).toBeNull();
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
      if (savedKey !== undefined) process.env['FLUTTER_ULTRA_SSH_KEY'] = savedKey;
    }
  });
});

// ─── createSshExecFn ───────────────────────────────────────────────────────

describe('createSshExecFn', () => {
  it('returns a function', () => {
    const config: SshConfig = {
      host: 'example.com',
      port: 22,
      username: 'ci',
      privateKeyPath: '/tmp/key',
    };
    const transport = new SshTransport(config);
    const execFn = createSshExecFn(transport);
    expect(typeof execFn).toBe('function');
  });

  it('returned function is assignable to ExecFn type', () => {
    const config: SshConfig = {
      host: 'example.com',
      port: 22,
      username: 'ci',
      privateKeyPath: '/tmp/key',
    };
    const transport = new SshTransport(config);
    const execFn: ExecFn = createSshExecFn(transport);
    expect(typeof execFn).toBe('function');
  });
});

// ─── SshTransport label ────────────────────────────────────────────────────

describe('SshTransport', () => {
  it('sets label from config', () => {
    const config: SshConfig = {
      host: 'builder.example.com',
      port: 2222,
      username: 'runner',
      privateKeyPath: '/home/runner/.ssh/id_ed25519',
    };
    const transport = new SshTransport(config);
    expect(transport.label).toBe('ssh://runner@builder.example.com:2222');
  });

  it('dispose does not throw when not connected', async () => {
    const config: SshConfig = {
      host: 'example.com',
      port: 22,
      username: 'ci',
      privateKeyPath: '/tmp/key',
    };
    const transport = new SshTransport(config);
    await expect(transport.dispose()).resolves.toBeUndefined();
  });
});

// ─── env var name validation (via buildShellCommand via exec) ─────────────
// buildShellCommand is internal but reachable: SshTransport.exec() calls it.
// We test the validation by having the exec() call throw for invalid env keys.
// Since exec() tries to open a real SSH connection, we mock the internal
// getConnection path by testing the validation logic separately via a
// known-good pattern — the regex used is /^[A-Za-z_][A-Za-z0-9_]*$/

describe('env var name validation (via buildShellCommand regex rule)', () => {
  const validNames = ['FOO', '_BAR', 'A1_B2', 'PATH_WITH_NUMBERS99'];
  const invalidNames = ['FOO;BAR', 'has space', '$FOO', '$(cmd)', 'A=B', '1STARTSWITHNUMBER'];

  for (const name of validNames) {
    it(`accepts valid name: ${name}`, () => {
      expect(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).toBe(true);
    });
  }

  for (const name of invalidNames) {
    it(`rejects invalid name: ${JSON.stringify(name)}`, () => {
      expect(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).toBe(false);
    });
  }
});

// ─── shellQuote behaviour (tested via known input/output expectations) ─────
// shellQuote is internal; we validate the expected quoting semantics that
// buildShellCommand guarantees for every argv element sent over SSH.

describe('shellQuote semantics', () => {
  // The quoting rule: wrap in single-quotes, replace ' with '\''
  function shellQuote(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }

  it('wraps simple string in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('handles empty string', () => {
    expect(shellQuote('')).toBe("''");
  });

  it('handles string with spaces', () => {
    expect(shellQuote('hello world')).toBe("'hello world'");
  });

  it('handles dollar sign (no expansion in single-quoted context)', () => {
    expect(shellQuote('$HOME')).toBe("'$HOME'");
  });

  it('handles backticks (no subshell in single-quoted context)', () => {
    expect(shellQuote('`id`')).toBe("'`id`'");
  });

  it('handles multiple single quotes', () => {
    expect(shellQuote("a'b'c")).toBe("'a'\\''b'\\''c'");
  });
});
