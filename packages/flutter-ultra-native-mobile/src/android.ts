// AndroidDevice — wraps `adb -s <udid>` invocations through a DeviceTransport.
//
// Every Android tool routes through here. Replacing `adb` with `ssh adb` for
// a remote-host scenario means swapping the base `argv` prefix only.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  LocalDevice,
  localTempPath,
  randomTempName,
  spawnAwait,
  type DeviceKind,
  type DeviceTransport,
  type ShellOptions,
  type ShellResult,
  type UploadOptions,
} from './device.js';
import { type ExecFn, type SshTransport } from './ssh.js';

export interface AndroidDeviceInfo {
  udid: string;
  state: 'device' | 'offline' | 'unauthorized' | 'no permissions' | 'recovery' | 'bootloader';
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
}

// AndroidDevice is a DeviceTransport whose `shell()` automatically scopes
// every argv to `adb -s <udid> shell ...`. Raw adb subcommands (push, pull,
// install) go through `host()`.
export class AndroidDevice implements DeviceTransport {
  readonly kind: DeviceKind = 'android';

  private readonly host: LocalDevice;

  constructor(
    readonly id: string,
    private readonly adbPath = 'adb',
    private readonly exec: ExecFn = spawnAwait,
    private readonly sshTransport?: SshTransport,
  ) {
    this.host = new LocalDevice(`adb-host-${id}`, 'android');
  }

  async meta(): Promise<Record<string, string>> {
    const props = await this.shell(['getprop'], { timeoutMs: 5_000 }).catch(() => null);
    const out: Record<string, string> = { udid: this.id };
    if (props?.ok) {
      const wanted = ['ro.product.model', 'ro.product.manufacturer', 'ro.build.version.release'];
      for (const key of wanted) {
        const m = new RegExp(`\\[${key}\\]: \\[([^\\]]*)\\]`).exec(props.stdout);
        if (m?.[1]) out[key] = m[1];
      }
    }
    return out;
  }

  // Run on-device shell. Equivalent to `adb -s <udid> shell <argv joined>`.
  // We pass argv to `adb shell` as separate args so adb does its own quoting.
  async shell(argv: readonly string[], options: ShellOptions = {}): Promise<ShellResult> {
    const full = [this.adbPath, '-s', this.id, 'shell', ...argv];
    return this.exec(full, options);
  }

  // adb non-shell subcommand (push, pull, install, ...). Used internally
  // by upload/download.
  async adb(argv: readonly string[], options: ShellOptions = {}): Promise<ShellResult> {
    return this.exec([this.adbPath, '-s', this.id, ...argv], options);
  }

  async upload(localPath: string, options: UploadOptions): Promise<string> {
    const res = await this.adb(['push', localPath, options.remotePath], { timeoutMs: 30_000 });
    if (!res.ok) {
      throw new Error(
        `adb push failed (exit ${String(res.exitCode)}): ${res.stderr.trim() || res.stdout.trim()}`,
      );
    }
    if (options.mode) {
      await this.shell(['chmod', options.mode.toString(8), options.remotePath]);
    }
    return options.remotePath;
  }

  async download(remotePath: string, localPath?: string): Promise<string> {
    const target = localPath ?? localTempPath('adb-pull');
    await mkdir(dirname(target), { recursive: true });
    if (this.sshTransport) {
      const remoteTmp = `/tmp/flutter-ultra-pull-${Date.now()}`;
      const res = await this.adb(['pull', remotePath, remoteTmp], { timeoutMs: 30_000 });
      if (!res.ok) {
        throw new Error(
          `adb pull failed (exit ${String(res.exitCode)}): ${res.stderr.trim() || res.stdout.trim()}`,
        );
      }
      await this.sshTransport.downloadFile(remoteTmp, target);
      return target;
    }
    const res = await this.adb(['pull', remotePath, target], { timeoutMs: 30_000 });
    if (!res.ok) {
      throw new Error(
        `adb pull failed (exit ${String(res.exitCode)}): ${res.stderr.trim() || res.stdout.trim()}`,
      );
    }
    return target;
  }

  // Stream-style operations (logcat tail, screenrecord) bypass spawnAwait
  // and are owned by tool code, not the Device interface — they need long-
  // lived processes the tool drives via stream cursors.
  // Exposed for tool code that needs ChildProcess control.
  get adbCli(): string {
    return this.adbPath;
  }

  async isAlive(): Promise<boolean> {
    const res = await this.exec([this.adbPath, '-s', this.id, 'get-state'], { timeoutMs: 5_000 });
    return res.ok && res.stdout.trim() === 'device';
  }

  async dispose(): Promise<void> {
    await this.host.dispose();
  }

  // -------- Higher-level Android helpers --------

  // UIAutomator dump → temp file → pull → parse. Returns the XML string.
  async uiautomatorDumpXml(options: ShellOptions = {}): Promise<string> {
    const remote = `/sdcard/${randomTempName('uia', '.xml')}`;
    const dumpRes = await this.shell(['uiautomator', 'dump', remote], {
      timeoutMs: options.timeoutMs ?? 30_000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!dumpRes.ok) {
      throw new Error(`uiautomator dump failed: ${dumpRes.stderr.trim() || dumpRes.stdout.trim()}`);
    }
    const xml = await this.shell(['cat', remote], {
      timeoutMs: 10_000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    // Best-effort cleanup; do not fail the whole call if rm fails.
    await this.shell(['rm', '-f', remote], { timeoutMs: 5_000 }).catch(() => undefined);
    if (!xml.ok) {
      throw new Error(`cat ${remote} failed: ${xml.stderr.trim()}`);
    }
    return xml.stdout;
  }

  // Screencap via adb exec-out (binary on stdout, no intermediate file).
  async screencapPng(options: ShellOptions = {}): Promise<Buffer> {
    const res = await this.exec([this.adbPath, '-s', this.id, 'exec-out', 'screencap', '-p'], {
      timeoutMs: 15_000,
      binaryStdout: true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!res.ok) {
      throw new Error(`screencap failed: ${res.stderr.trim()}`);
    }
    return Buffer.from(res.stdout, 'base64');
  }

  // Dispatch a deep-link intent. The §5.5.1 OAuth solver depends on this.
  async dispatchDeepLink(redirectUrl: string, packageName?: string): Promise<ShellResult> {
    const args = [
      'am',
      'start',
      '-W', // wait until foreground
      '-a',
      'android.intent.action.VIEW',
      '-d',
      redirectUrl,
    ];
    if (packageName) args.push(packageName);
    return this.shell(args, { timeoutMs: 15_000 });
  }
}

// `adb devices -l` parser. Format example line:
//   emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1
export function parseAdbDevices(text: string): AndroidDeviceInfo[] {
  const out: AndroidDeviceInfo[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('List of devices')) continue;
    if (trimmed.startsWith('*')) continue; // adb daemon notices
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const [udid, state, ...rest] = parts;
    if (!udid || !state) continue;
    const info: AndroidDeviceInfo = {
      udid,
      state: state as AndroidDeviceInfo['state'],
    };
    for (const kv of rest) {
      const m = /^([a-zA-Z_]+):(.+)$/.exec(kv);
      if (!m) continue;
      const [, k, v] = m;
      if (!k || v === undefined) continue;
      switch (k) {
        case 'product':
          info.product = v;
          break;
        case 'model':
          info.model = v;
          break;
        case 'device':
          info.device = v;
          break;
        case 'transport_id':
          info.transportId = v;
          break;
      }
    }
    out.push(info);
  }
  return out;
}

// Enumerate Android devices via `adb devices -l`.
export async function listAndroidDevices(adbPath = 'adb'): Promise<AndroidDeviceInfo[]> {
  const res = await spawnAwait([adbPath, 'devices', '-l'], { timeoutMs: 5_000 });
  if (!res.ok) {
    // adb missing / daemon unstartable: callers see an empty list.
    return [];
  }
  return parseAdbDevices(res.stdout);
}

// Write input to a temp file then push to device — used when a single
// long shell command would blow past Windows command-line length limits.
export async function uploadString(
  device: AndroidDevice,
  content: string,
  remotePath: string,
  mode = 0o644,
): Promise<void> {
  const local = localTempPath('upload', '.bin');
  await mkdir(dirname(local), { recursive: true });
  await writeFile(local, content);
  await device.upload(local, { remotePath, mode });
}
