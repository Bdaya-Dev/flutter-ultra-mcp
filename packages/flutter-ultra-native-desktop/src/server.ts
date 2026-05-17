// MCP server construction. Holds one DesktopBackend across all requests.
//
// Device is selected at construction time. The backend is chosen from
// device.platform: Linux → LinuxDesktopBackend over the AT-SPI sidecar.
// Windows + macOS backends ship in sibling packages and will register
// here via the same DesktopBackend interface once worker I/J merge.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { DesktopBackend } from './backend.js';
import { LocalLinuxDevice, type Device } from './device.js';
import { LinuxDesktopBackend } from './linux-backend.js';
import { SidecarRegistry, type SidecarOptions } from './sidecar.js';
import { allTools, type Tool, type ToolContext } from './tools.js';

export interface NativeDesktopServerOptions {
  device?: Device;
  /** Override the backend selection (tests, future Windows/macOS impls). */
  backend?: DesktopBackend;
  sidecar?: SidecarOptions;
}

export interface NativeDesktopServer {
  server: Server;
  device: Device;
  backend: DesktopBackend;
  sidecars: SidecarRegistry;
  dispose(): Promise<void>;
}

export function createNativeDesktopServer(
  options: NativeDesktopServerOptions = {},
): NativeDesktopServer {
  const device = options.device ?? new LocalLinuxDevice();
  const sidecars = new SidecarRegistry(options.sidecar ?? {});
  const backend = options.backend ?? selectBackend(device, sidecars);

  const tools = allTools();
  const toolMap = new Map<string, Tool>();
  for (const tool of tools) toolMap.set(tool.name, tool);

  const server = new Server(
    {
      name: 'flutter-ultra-native-desktop',
      version: '0.0.1',
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputJsonSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolMap.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      };
    }
    const parsed = tool.inputSchema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid input for ${tool.name}: ${parsed.error.message}`,
          },
        ],
      };
    }
    const ctx: ToolContext = { device, backend };
    try {
      const result = await tool.handler(parsed.data, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  });

  server.onclose = (): void => {
    void backend.dispose();
    void sidecars.disposeAll();
    void device.close();
  };

  return {
    server,
    device,
    backend,
    sidecars,
    dispose: async () => {
      await backend.dispose();
      await sidecars.disposeAll();
      await device.close();
    },
  };
}

function selectBackend(device: Device, sidecars: SidecarRegistry): DesktopBackend {
  switch (device.platform) {
    case 'linux':
      return new LinuxDesktopBackend(device, sidecars);
    case 'darwin':
      throw new Error(
        'macOS backend lives in @flutter-ultra/flutter-ultra-native-desktop-macos (worker J). ' +
          'Pass `backend` explicitly until the cross-platform package merges.',
      );
    case 'win32':
      throw new Error(
        'Windows backend lives in @flutter-ultra/flutter-ultra-native-desktop-windows (worker I). ' +
          'Pass `backend` explicitly until the cross-platform package merges.',
      );
    default:
      throw new Error(`Unsupported device platform: ${String(device.platform)}`);
  }
}
