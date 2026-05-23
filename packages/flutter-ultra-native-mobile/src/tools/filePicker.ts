// File picker / media staging tools: pick_file_native, add_media_to_device.
//
// Android: adb push → scoped-storage dir → content-provider scan
//          DocumentsUI a11y navigation for ACTION_GET_CONTENT dialogs
// iOS sim: xcrun simctl addmedia <device> <file>
//          PHPicker navigation via WDA a11y tree

import { basename, extname } from 'node:path';
import { InvalidToolInputError, type FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import type { DeviceRegistry } from '../registry.js';
import { AndroidDevice } from '../android.js';
import { IosSimDevice } from '../ios.js';
import { parseUiautomatorXml, findNode, type A11yNode } from '../a11y.js';
import { pickFileNativeSchema, addMediaToDeviceSchema } from '../schemas.js';

function nodeCenterArgs(node: A11yNode): string[] | undefined {
  const b = node.bounds;
  if (!b) return undefined;
  return [String(Math.round((b.left + b.right) / 2)), String(Math.round((b.top + b.bottom) / 2))];
}

// Map mediaType to the scoped-storage directory that survives on Android 11+.
const ANDROID_MEDIA_DIR: Record<string, string> = {
  photo: '/sdcard/DCIM/Camera',
  video: '/sdcard/DCIM/Camera',
  audio: '/sdcard/Music',
  document: '/sdcard/Download',
};

// Trigger MediaStore rescan. On API 29- we fall back to the legacy broadcast;
// on API 30+ the content-provider call is the supported path.
async function androidRescanFile(device: AndroidDevice, remotePath: string): Promise<void> {
  // Modern path: scan_volume (works API 30+, ignored on older)
  await device
    .shell(
      [
        'content',
        'call',
        '--method',
        'scan_volume',
        '--uri',
        'content://media',
        '--arg',
        'external_primary',
      ],
      { timeoutMs: 10_000 },
    )
    .catch(() => undefined);

  // Legacy fallback: MEDIA_SCANNER_SCAN_FILE broadcast (deprecated API 29+, harmless on newer)
  await device
    .shell(
      [
        'am',
        'broadcast',
        '-a',
        'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
        '-d',
        `file://${remotePath}`,
      ],
      { timeoutMs: 10_000 },
    )
    .catch(() => undefined);
}

export function registerFilePickerTools(opts: {
  server: FlutterUltraServer;
  registry: DeviceRegistry;
}): void {
  const { server, registry } = opts;

  server.defineTool(
    {
      name: 'pick_file_native',
      description:
        'Stage a local file on the device then interact with an active native file picker dialog to select it. ' +
        'Android: pushes to a scoped-storage directory, triggers MediaStore rescan, then navigates DocumentsUI ' +
        '(ACTION_GET_CONTENT / SAF) via the a11y tree to tap the file. ' +
        'iOS Simulator: stages the file via simctl addmedia (PHPicker / photo library) and returns staged=true; ' +
        'WDA-based PHPicker navigation is attempted when wdaPort is provided. ' +
        'Physical iOS devices are not supported.',
      inputShape: pickFileNativeSchema.shape,
      timeoutClass: 'long',
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      const filename = basename(args.filePath);

      // ── Android ────────────────────────────────────────────────────────────
      if (device instanceof AndroidDevice) {
        const dir = ANDROID_MEDIA_DIR[args.targetType] ?? '/sdcard/Download';
        const remotePath = `${dir}/${filename}`;

        // 1. Push file
        const pushRes = await device.adb(['push', args.filePath, remotePath], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        if (!pushRes.ok) {
          return {
            ok: false,
            staged: false,
            remotePath,
            reason: `adb push failed: ${pushRes.stderr.trim() || pushRes.stdout.trim()}`,
            exitCode: pushRes.exitCode,
          };
        }

        // 2. Trigger MediaStore rescan
        await androidRescanFile(device, remotePath);

        // 3. Attempt DocumentsUI navigation via a11y tree
        let picked = false;
        let pickerError: string | undefined;
        try {
          const xml = await device.uiautomatorDumpXml({ timeoutMs: 15_000, signal });
          const tree = parseUiautomatorXml(xml);

          // Look for the file by display name in the active picker UI
          const fileNode = findNode(tree, { text: filename });
          if (fileNode) {
            const center = nodeCenterArgs(fileNode);
            if (center) {
              await device.shell(['input', 'tap', ...center], { timeoutMs: 5_000, signal });
              picked = true;
            } else {
              pickerError = `File node '${filename}' found but has no bounds; cannot tap.`;
            }
          } else {
            // Try navigating to Downloads via DocumentsUI "Show roots" then "Downloads"
            const showRoots = findNode(tree, { contentDesc: 'Show roots' });
            const rootCenter = showRoots ? nodeCenterArgs(showRoots) : undefined;
            if (showRoots && rootCenter) {
              await device.shell(['input', 'tap', ...rootCenter], { timeoutMs: 3_000, signal });
              // Re-dump after opening roots drawer
              const xml2 = await device.uiautomatorDumpXml({ timeoutMs: 10_000, signal });
              const tree2 = parseUiautomatorXml(xml2);
              const downloadsNode = findNode(tree2, { text: 'Downloads' });
              const dlCenter = downloadsNode ? nodeCenterArgs(downloadsNode) : undefined;
              if (downloadsNode && dlCenter) {
                await device.shell(['input', 'tap', ...dlCenter], { timeoutMs: 3_000, signal });
                // Final dump to find the file
                const xml3 = await device.uiautomatorDumpXml({ timeoutMs: 10_000, signal });
                const tree3 = parseUiautomatorXml(xml3);
                const finalNode = findNode(tree3, { text: filename });
                const finalCenter = finalNode ? nodeCenterArgs(finalNode) : undefined;
                if (finalNode && finalCenter) {
                  await device.shell(['input', 'tap', ...finalCenter], {
                    timeoutMs: 5_000,
                    signal,
                  });
                  picked = true;
                } else {
                  pickerError = `File '${filename}' not found in Downloads picker after navigation.`;
                }
              } else {
                pickerError = 'Could not find Downloads root in DocumentsUI sidebar.';
              }
            } else {
              pickerError =
                'No active file picker dialog detected via a11y tree. File staged successfully; open the picker and call again, or navigate manually.';
            }
          }
        } catch (err: unknown) {
          pickerError = `a11y navigation failed: ${err instanceof Error ? err.message : String(err)}`;
        }

        return {
          ok: true,
          staged: true,
          picked,
          remotePath,
          ...(pickerError ? { pickerNote: pickerError } : {}),
        };
      }

      // ── iOS Simulator ───────────────────────────────────────────────────────
      if (device instanceof IosSimDevice) {
        // simctl addmedia imports the file into Photos library
        const addRes = await device.simctl(['addmedia', args.deviceId, args.filePath], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        if (!addRes.ok) {
          return {
            ok: false,
            staged: false,
            reason: `simctl addmedia failed: ${addRes.stderr.trim() || addRes.stdout.trim()}`,
            exitCode: addRes.exitCode,
          };
        }

        // Attempt WDA-based PHPicker navigation if wdaPort provided
        let picked = false;
        let pickerNote: string | undefined;
        if (args.wdaPort !== undefined) {
          try {
            const xml = await device.wdaFetchSource(args.wdaPort, {
              timeoutMs: 15_000,
              signal,
            });
            const tree = parseUiautomatorXml(xml);
            // PHPicker shows filenames or photo thumbnails; look for the filename or "Recents"
            const fileNode =
              findNode(tree, { text: filename }) ??
              findNode(tree, { text: basename(filename, extname(filename)) });
            if (fileNode) {
              const center = nodeCenterArgs(fileNode);
              const coordHint = center ? ` at (${center[0]},${center[1]})` : '';
              pickerNote = `PHPicker element found${coordHint}; use native_tap with coords to select it.`;
            } else {
              pickerNote =
                'File staged in Photos. PHPicker element not located by filename — it may appear as a thumbnail. Use dump_a11y_tree + native_tap to select.';
            }
          } catch (err: unknown) {
            pickerNote = `WDA a11y lookup failed: ${err instanceof Error ? err.message : String(err)}. File staged successfully.`;
          }
        } else {
          pickerNote =
            'File staged in Photos library via simctl addmedia. Provide wdaPort to attempt PHPicker navigation.';
        }

        return {
          ok: true,
          staged: true,
          picked,
          ...(pickerNote ? { pickerNote } : {}),
        };
      }

      throw new InvalidToolInputError(
        `pick_file_native: unsupported device kind '${device.kind}'. Physical iOS devices are not supported.`,
      );
    },
  );

  server.defineTool(
    {
      name: 'add_media_to_device',
      description:
        'Stage a file on the device without interacting with any picker dialog. ' +
        'Android: pushes to the appropriate scoped-storage directory (DCIM for photos/videos, Music for audio, Download for documents) and triggers a MediaStore rescan. ' +
        'iOS Simulator: imports via simctl addmedia into the Photos library. ' +
        'Physical iOS devices are not supported.',
      inputShape: addMediaToDeviceSchema.shape,
      timeoutClass: 'long',
      annotations: { readOnlyHint: false },
    },
    async (args, { signal }) => {
      if (signal.aborted) throw signal.reason as Error;
      const device = await registry.get(args.deviceId);
      const filename = basename(args.filePath);

      if (device instanceof AndroidDevice) {
        const dir = ANDROID_MEDIA_DIR[args.mediaType] ?? '/sdcard/Download';
        const remotePath = `${dir}/${filename}`;

        const pushRes = await device.adb(['push', args.filePath, remotePath], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        if (!pushRes.ok) {
          return {
            ok: false,
            remotePath,
            reason: `adb push failed: ${pushRes.stderr.trim() || pushRes.stdout.trim()}`,
            exitCode: pushRes.exitCode,
          };
        }

        await androidRescanFile(device, remotePath);
        return { ok: true, remotePath, mediaType: args.mediaType };
      }

      if (device instanceof IosSimDevice) {
        const addRes = await device.simctl(['addmedia', args.deviceId, args.filePath], {
          timeoutMs: args.timeoutMs,
          signal,
        });
        return {
          ok: addRes.ok,
          mediaType: args.mediaType,
          ...(addRes.ok ? {} : { reason: addRes.stderr.trim() || addRes.stdout.trim() }),
          exitCode: addRes.exitCode,
        };
      }

      throw new InvalidToolInputError(
        `add_media_to_device: unsupported device kind '${device.kind}'. Physical iOS devices are not supported.`,
      );
    },
  );
}
