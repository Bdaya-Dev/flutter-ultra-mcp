# @flutter-ultra/device-router

Device abstraction for flutter-ultra-mcp: run commands on local, WSL, or SSH-remote targets from a single interface.

## Usage

```typescript
import { DeviceRouter } from '@flutter-ultra/device-router';

const router = new DeviceRouter();

// List available devices (local + WSL distros + SSH hosts)
const devices = await router.listAvailable();

// Connect to a WSL distro
const { device, probe } = await router.connect({ kind: 'wsl', distro: 'Ubuntu-22.04' });

// Run a command on the device
const result = await device.exec(['flutter', 'build', 'linux', '--release']);

// Forward a TCP port from the remote device to local
const fwd = await device.forwardTcpPort('localhost', 8080);
console.log(`VM service available at ws://localhost:${fwd.localPort}/ws`);

// Clean up
await fwd.close();
await router.disconnect(device.id);
```

## Device types

| Kind    | Transport             | Platform    | Use case                                |
| ------- | --------------------- | ----------- | --------------------------------------- |
| `local` | `child_process`       | Host OS     | Default — same machine                  |
| `wsl`   | `wsl.exe -d <distro>` | Linux       | Flutter Linux builds/tests from Windows |
| `ssh`   | SSH ControlMaster     | Linux/macOS | Flutter macOS builds via remote Mac     |

## Legacy adapter

Existing code using worker-J's v1 Device shape (`label/isLocal/exec/uploadFile/fileExists/openRpcStream`) can use the `LegacyDeviceAdapter`:

```typescript
import { LegacyDeviceAdapter } from '@flutter-ultra/device-router';

const legacy = new LegacyDeviceAdapter(device);
// legacy.label, legacy.isLocal, legacy.exec(), legacy.fileExists(), legacy.openRpcStream()
```

## License

Apache-2.0
