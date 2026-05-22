import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type {
  mockNetworkRouteSchema,
  unmockNetworkRouteSchema,
  listMockRoutesSchema,
  networkStateSetSchema,
} from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function mockNetworkRoute(
  args: z.infer<typeof mockNetworkRouteSchema>,
): Promise<ToolReturn> {
  try {
    const route = await browserManager.mockNetworkRoute({
      contextId: args.contextId,
      pattern: args.pattern,
      status: args.status,
      headers: args.headers,
      body: args.body,
      encoding: args.encoding,
    });
    return ok({
      contextId: args.contextId,
      pattern: route.pattern,
      status: route.status,
      headers: route.headers,
      encoding: route.encoding,
      addedAt: route.addedAt,
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`mock_network_route failed: ${message}`, hint);
  }
}

export async function unmockNetworkRoute(
  args: z.infer<typeof unmockNetworkRouteSchema>,
): Promise<ToolReturn> {
  try {
    const removed = await browserManager.unmockNetworkRoute({
      contextId: args.contextId,
      pattern: args.pattern,
    });
    return ok({ contextId: args.contextId, pattern: args.pattern, removed });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`unmock_network_route failed: ${message}`, hint);
  }
}

export async function listMockRoutes(
  args: z.infer<typeof listMockRoutesSchema>,
): Promise<ToolReturn> {
  try {
    const routes = browserManager.listMockRoutes(args.contextId);
    return ok({
      contextId: args.contextId,
      routes: routes.map((r) => ({
        pattern: r.pattern,
        status: r.status,
        headers: r.headers,
        encoding: r.encoding,
        addedAt: r.addedAt,
      })),
      total: routes.length,
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`list_mock_routes failed: ${message}`, hint);
  }
}

export async function networkStateSet(
  args: z.infer<typeof networkStateSetSchema>,
): Promise<ToolReturn> {
  try {
    await browserManager.setNetworkState({ contextId: args.contextId, offline: args.offline });
    return ok({ contextId: args.contextId, offline: args.offline });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`network_state_set failed: ${message}`, hint);
  }
}
