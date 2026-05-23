// IosDevice — wraps simctl (simulators) and go-ios (physical devices).
//
// iOS tools are usable only on darwin OR when the user has supplied a
// go-ios binary that can talk to a physical device over USB. Every iOS
// tool calls platformGuard() at the top to surface a clean error on
// unsupported hosts.

import {
  LocalDevice,
  localTempPath,
  spawnAwait,
  type DeviceKind,
  type DeviceTransport,
  type ShellOptions,
  type ShellResult,
  type UploadOptions,
} from './device.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type ExecFn, type SshTransport } from './ssh.js';

export interface IosDeviceInfo {
  udid: string;
  name: string;
  state: 'Booted' | 'Shutdown' | 'Unknown' | string;
  kind: 'sim' | 'physical';
  runtime?: string; // e.g. iOS 17.4 (sim only)
  model?: string; // e.g. iPhone15,2 (physical only)
}

export class IosSimDevice implements DeviceTransport {
  readonly kind: DeviceKind = 'ios-sim';

  private readonly host: LocalDevice;

  constructor(
    readonly id: string,
    private readonly xcrunPath = 'xcrun',
    private readonly exec: ExecFn = spawnAwait,
    private readonly sshTransport?: SshTransport,
  ) {
    this.host = new LocalDevice(`sim-host-${id}`, 'ios-sim');
  }

  async meta(): Promise<Record<string, string>> {
    return { udid: this.id, kind: 'sim' };
  }

  // Sim "shell" is `xcrun simctl spawn <udid> <argv>` for arbitrary commands.
  async shell(argv: readonly string[], options: ShellOptions = {}): Promise<ShellResult> {
    if (argv.length === 0) {
      return {
        ok: false,
        stdout: '',
        stderr: 'empty argv',
        exitCode: null,
        signal: null,
        durationMs: 0,
      };
    }
    return this.exec([this.xcrunPath, 'simctl', 'spawn', this.id, ...argv], options);
  }

  // High-level simctl helpers. Many iOS tools go through these instead of
  // shell() because simctl has its own subcommands (openurl, io, screenshot).
  async simctl(argv: readonly string[], options: ShellOptions = {}): Promise<ShellResult> {
    return this.exec([this.xcrunPath, 'simctl', ...argv], options);
  }

  async upload(localPath: string, options: UploadOptions): Promise<string> {
    // Simulator: `simctl push <udid> <bundle-id> <file>` for notifications,
    // or `simctl io booted addmedia <file>`. For arbitrary file upload to
    // the sim container we'd need bundle-id context — surface that the
    // caller picks the right verb.
    // For generic transfer to the host filesystem we just copy.
    if (this.sshTransport) {
      await this.sshTransport.uploadFile(localPath, options.remotePath);
      return options.remotePath;
    }
    if (localPath !== options.remotePath) {
      const data = await readFile(localPath);
      await mkdir(dirname(options.remotePath), { recursive: true });
      await writeFile(options.remotePath, data, options.mode ? { mode: options.mode } : undefined);
    }
    return options.remotePath;
  }

  async download(remotePath: string, localPath?: string): Promise<string> {
    const target = localPath ?? localTempPath('sim-pull');
    if (this.sshTransport) {
      await this.sshTransport.downloadFile(remotePath, target);
      return target;
    }
    const data = await readFile(remotePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    return target;
  }

  async isAlive(): Promise<boolean> {
    const res = await this.exec([this.xcrunPath, 'simctl', 'list', 'devices', '-j']);
    if (!res.ok) return false;
    return res.stdout.includes(this.id);
  }

  async dispose(): Promise<void> {
    await this.host.dispose();
  }

  // Dispatch a URL — sim equivalent of `am start -d <url>`.
  async openUrl(url: string, options: ShellOptions = {}): Promise<ShellResult> {
    return this.simctl(['openurl', this.id, url], { timeoutMs: 10_000, ...options });
  }

  // Press a hardware button on the simulator via `simctl io pressButton`.
  // Supported buttons: home, lock, sideButton, volumeUp, volumeDown.
  // App-switcher is emulated by double-tapping home with a short delay.
  async pressButton(
    button: 'home' | 'lock' | 'sideButton' | 'volumeUp' | 'volumeDown',
    options: ShellOptions = {},
  ): Promise<ShellResult> {
    return this.simctl(['io', this.id, 'pressButton', button], {
      timeoutMs: 10_000,
      ...options,
    });
  }

  // Fetch the WDA accessibility tree XML from a running WebDriverAgent
  // instance. WDA must be started separately (e.g. via xcodebuild or Appium)
  // and listening on `wdaPort` (default 8100).
  //
  // Endpoint: GET http://localhost:<port>/source?onlyVisible=true
  // Returns the raw XML string (WDA/Appium page source format).
  async wdaFetchSource(wdaPort = 8100, options: ShellOptions = {}): Promise<string> {
    const url = `http://localhost:${String(wdaPort)}/source?onlyVisible=true`;
    // Use curl so we don't need a Node HTTP dependency in this low-level module.
    const res = await this.exec(['curl', '-sf', '--max-time', '20', url], {
      timeoutMs: options.timeoutMs ?? 25_000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!res.ok) {
      const hint =
        res.stderr.includes('Connection refused') || res.stderr.includes('Failed to connect')
          ? ' WebDriverAgent is not running on that port. Start WDA first: xcodebuild test -scheme WebDriverAgentRunner -destination "id=<udid>"'
          : '';
      throw new Error(
        `WDA /source request failed (exit ${String(res.exitCode)}): ${res.stderr.trim()}${hint}`,
      );
    }
    return res.stdout;
  }

  // Grant or revoke a simulator privacy permission without a UI dialog.
  // Wraps `xcrun simctl privacy <udid> grant|revoke <service> <bundleId>`.
  // Common services: camera, microphone, photos, location, contacts,
  //                  calendar, reminders, motion, health, homekit,
  //                  siri, speech, media-library, all.
  async simctlPrivacy(
    action: 'grant' | 'revoke' | 'reset',
    service: string,
    bundleId: string,
    options: ShellOptions = {},
  ): Promise<ShellResult> {
    return this.simctl(['privacy', this.id, action, service, bundleId], {
      timeoutMs: 15_000,
      ...options,
    });
  }

  async screenshotPng(options: ShellOptions = {}): Promise<Buffer> {
    if (this.sshTransport) {
      const remoteTmp = `/tmp/flutter-ultra-screenshot-${Date.now()}.png`;
      const res = await this.simctl(['io', this.id, 'screenshot', remoteTmp], {
        timeoutMs: 15_000,
        ...options,
      });
      if (!res.ok) {
        throw new Error(`simctl screenshot failed: ${res.stderr.trim()}`);
      }
      return this.sshTransport.readRemoteFile(remoteTmp);
    }
    const tmp = localTempPath('sim-screenshot', '.png');
    await mkdir(dirname(tmp), { recursive: true });
    const res = await this.simctl(['io', this.id, 'screenshot', tmp], {
      timeoutMs: 15_000,
      ...options,
    });
    if (!res.ok) {
      throw new Error(`simctl screenshot failed: ${res.stderr.trim()}`);
    }
    return readFile(tmp);
  }
}

// Physical iOS via go-ios. The go-ios binary (or the npm `appium-go-ios`
// wrapper) provides install / launch / syslog / mounts. Required because
// xcrun simctl only handles simulators.
export class IosPhysicalDevice implements DeviceTransport {
  readonly kind: DeviceKind = 'ios-real';

  private readonly host: LocalDevice;

  constructor(
    readonly id: string,
    private readonly iosCli = 'ios',
  ) {
    this.host = new LocalDevice(`ios-host-${id}`, 'ios-real');
  }

  async meta(): Promise<Record<string, string>> {
    const res = await spawnAwait([this.iosCli, 'info', '--udid', this.id], {
      timeoutMs: 5_000,
    });
    const out: Record<string, string> = { udid: this.id, kind: 'physical' };
    if (res.ok) {
      try {
        const json = JSON.parse(res.stdout) as Record<string, unknown>;
        if (typeof json.DeviceName === 'string') out.name = json.DeviceName;
        if (typeof json.ProductType === 'string') out.model = json.ProductType;
        if (typeof json.ProductVersion === 'string') out.osVersion = json.ProductVersion;
      } catch {
        // ignore parse error
      }
    }
    return out;
  }

  async shell(argv: readonly string[], options: ShellOptions = {}): Promise<ShellResult> {
    // go-ios doesn't expose a generic shell — every operation is a subcommand.
    // Tool code that needs go-ios should call this.cli() directly.
    return spawnAwait([this.iosCli, '--udid', this.id, ...argv], options);
  }

  // Direct go-ios subcommand (without forcing `--udid` re-insertion).
  async cli(argv: readonly string[], options: ShellOptions = {}): Promise<ShellResult> {
    return spawnAwait([this.iosCli, ...argv, '--udid', this.id], options);
  }

  async upload(_localPath: string, _options: UploadOptions): Promise<string> {
    // go-ios provides house-arrest / docs operations; arbitrary FS upload
    // requires choosing a bundle-id namespace. Surface as unsupported until
    // a tool needs it.
    throw new Error(
      'IosPhysicalDevice.upload: not implemented. Pick an iOS-specific subcommand (house-arrest, install).',
    );
  }

  async download(_remotePath: string, _localPath?: string): Promise<string> {
    throw new Error(
      'IosPhysicalDevice.download: not implemented. Pick a go-ios subcommand (syslog, install info).',
    );
  }

  async isAlive(): Promise<boolean> {
    const res = await spawnAwait([this.iosCli, 'list'], { timeoutMs: 5_000 });
    return res.ok && res.stdout.includes(this.id);
  }

  async dispose(): Promise<void> {
    await this.host.dispose();
  }

  async openUrl(_url: string, _options: ShellOptions = {}): Promise<ShellResult> {
    // `idb open --udid <uuid> <url>` would do this. go-ios alone has no
    // direct equivalent; surface as unsupported and let the caller branch.
    return {
      ok: false,
      stdout: '',
      stderr:
        'Physical iOS deep-link dispatch requires `idb` (facebook/idb). Not implemented in go-ios path; install idb and call directly.',
      exitCode: 1,
      signal: null,
      durationMs: 0,
    };
  }
}

// Parse `xcrun simctl list devices -j`.
export interface SimctlDevicesJson {
  devices: Record<
    string,
    Array<{ udid: string; name: string; state: string; isAvailable?: boolean }>
  >;
}

export function parseSimctlDevices(json: SimctlDevicesJson): IosDeviceInfo[] {
  const out: IosDeviceInfo[] = [];
  for (const [runtime, list] of Object.entries(json.devices)) {
    for (const d of list) {
      if (d.isAvailable === false) continue;
      out.push({
        udid: d.udid,
        name: d.name,
        state: d.state,
        kind: 'sim',
        runtime: runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, ''),
      });
    }
  }
  return out;
}

// Enumerate iOS sims via simctl. Returns [] on non-darwin or simctl missing.
export async function listIosSimulators(xcrunPath = 'xcrun'): Promise<IosDeviceInfo[]> {
  if (process.platform !== 'darwin') return [];
  const res = await spawnAwait([xcrunPath, 'simctl', 'list', 'devices', '-j'], {
    timeoutMs: 5_000,
  });
  if (!res.ok) return [];
  try {
    const json = JSON.parse(res.stdout) as SimctlDevicesJson;
    return parseSimctlDevices(json);
  } catch {
    return [];
  }
}

// Enumerate physical iOS via go-ios.
export async function listIosPhysical(iosCli = 'ios'): Promise<IosDeviceInfo[]> {
  const res = await spawnAwait([iosCli, 'list'], { timeoutMs: 5_000 });
  if (!res.ok) return [];
  const out: IosDeviceInfo[] = [];
  // go-ios prints either JSON or one UDID per line depending on flags.
  // Default `ios list` emits a JSON array like {"deviceList":["UDID1","UDID2"]}.
  try {
    const json = JSON.parse(res.stdout) as { deviceList?: string[] };
    if (Array.isArray(json.deviceList)) {
      for (const udid of json.deviceList) {
        out.push({ udid, name: udid, state: 'unknown', kind: 'physical' });
      }
    }
  } catch {
    for (const line of res.stdout.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      out.push({ udid: t, name: t, state: 'unknown', kind: 'physical' });
    }
  }
  return out;
}

// Hard guard for tools that are mac-only. Returns null when supported,
// or a CallToolResult-shaped error when not.
export function platformGuard(opts: {
  toolName: string;
  requireSimulator?: boolean;
  requirePhysical?: boolean;
}): { supported: true } | { supported: false; reason: string } {
  if (opts.requireSimulator && process.platform !== 'darwin') {
    return {
      supported: false,
      reason: `${opts.toolName}: iOS Simulator tools are only available on macOS (you're on ${process.platform}).`,
    };
  }
  // Physical iOS uses go-ios which works on all hosts in principle; the
  // tool itself will fail at exec time if the binary is missing. We don't
  // hard-block by platform.
  if (opts.requirePhysical) return { supported: true };
  return { supported: true };
}
