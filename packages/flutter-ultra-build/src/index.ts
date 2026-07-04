/**
 * flutter-ultra-build MCP server module (executable entry lives in bin.ts).
 *
 * Bundles all build-time tools per plan §5.1 (~50 tools after rev-10 expansion):
 *   - Project meta:        list_projects, project_info, list_flavors, list_dart_defines
 *   - Analysis & format:   analyze, format, fix, fix_preview, flutter_doctor, flutter_clean,
 *                          pub_cache_repair
 *   - Pubspec:             pub_get, pub_add, pub_remove, pub_upgrade, pub_outdated, pub_deps,
 *                          pub_dev_search,
 *                          pubspec_overrides_set / pubspec_overrides_remove / pubspec_overrides_list,
 *                          start_pub_upgrade_major / poll / get / cancel
 *   - Codegen:             start_build_runner_build / poll / get / cancel,
 *                          start_build_runner_watch / poll / stop,
 *                          flutter_gen_l10n
 *   - Tests:               start_run_*_tests / poll / get / cancel  (unit/widget/integration/golden + update_goldens),
 *                          test_filter
 *   - Builds:              start_build_<plat> / poll / get / cancel
 *                          (apk / appbundle / ipa / web / windows / macos / linux)
 *   - Signing:             verify_android_signing, verify_ios_signing, set_bundle_id
 *   - l10n:                list_missing_translations, arb_diff, arb_add_key, arb_remove_key
 *   - Assets:              add_asset, validate_assets, list_orphan_assets
 *   - Web validators:      validate_web_redirect, validate_canvaskit_vs_html_consistency,
 *                          flush_service_worker
 *
 * Transport: stdio. Logging: stderr JSON-lines. Keep-alive: 30s debug notifications
 * to defeat Bun-idle-SIGKILL (plan §17.9).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SERVER_NAME, SERVER_VERSION } from './constants.js';
import { startKeepAlive } from './runtime/keepAlive.js';
import { log } from './runtime/logger.js';
import { shutdownAllJobs } from './runtime/jobs.js';
import { register as registerProject } from './tools/project.js';
import { register as registerAnalysis } from './tools/analysis.js';
import { register as registerPubspec } from './tools/pubspec.js';
import { register as registerCodegen } from './tools/codegen.js';
import { register as registerTests } from './tools/tests.js';
import { register as registerBuilds } from './tools/builds.js';
import { register as registerSigning } from './tools/signing.js';
import { register as registerL10n } from './tools/l10n.js';
import { register as registerAssets } from './tools/assets.js';
import { register as registerWebValidators } from './tools/webValidators.js';
import { register as registerRecording } from './tools/recording.js';
import { register as registerPackages } from './tools/packages.js';
import { register as registerLsp } from './tools/lsp.js';

export { SERVER_NAME, SERVER_VERSION };

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: { listChanged: false },
        logging: {},
      },
    },
  );

  registerProject(server);
  registerAnalysis(server);
  registerPubspec(server);
  registerCodegen(server);
  registerTests(server);
  registerBuilds(server);
  registerSigning(server);
  registerL10n(server);
  registerAssets(server);
  registerWebValidators(server);
  registerRecording(server);
  registerPackages(server);
  registerLsp(server);

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  const stopKeepAlive = startKeepAlive(server);

  const shutdown = async (signal: string) => {
    log.info('shutdown requested', { signal });
    stopKeepAlive();
    shutdownAllJobs();
    try {
      await server.close();
    } catch (e) {
      log.warn('server.close threw on shutdown', {
        err: e instanceof Error ? e.message : String(e),
      });
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('server started', { server: SERVER_NAME, version: SERVER_VERSION });
}

// No main-module guard here: `import.meta.url` vs `process.argv[1]` diverges
// when the bundle is spawned through a symlink/junction (Node resolves the main
// module's realpath while argv[1] keeps the link path), making the process exit
// 0 silently. The always-run entry lives in bin.ts, like the other servers.
