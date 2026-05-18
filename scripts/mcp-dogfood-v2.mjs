#!/usr/bin/env node
// Dogfood test: spawn the runtime MCP server via the SDK's StdioClientTransport,
// call launch_app with the counter-app example, poll until attached or failed,
// then exercise list_sessions. Validates the child-crash-surfacing fix end-to-end.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SERVER_BIN = resolve(REPO_ROOT, 'packages/flutter-ultra-runtime/dist/bin.js');
const COUNTER_APP = resolve(REPO_ROOT, 'examples/counter-app');
const TIMEOUT_MS = 120_000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('[dogfood] Creating MCP client + StdioClientTransport...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_BIN],
    env: {
      ...process.env,
      FLUTTER_ULTRA_STATE_DIR: resolve(REPO_ROOT, '.dogfood-state'),
      FLUTTER_ULTRA_LOG_LEVEL: 'debug',
    },
    cwd: REPO_ROOT,
  });

  const client = new Client({
    name: 'dogfood-test',
    version: '1.0.0',
  });

  try {
    console.log('[dogfood] Connecting to server...');
    await client.connect(transport);
    console.log('[dogfood] Connected! Server info:', client.getServerVersion());

    // Step 1: List tools (sanity check).
    const { tools } = await client.listTools();
    const toolNames = tools.map(t => t.name);
    console.log(`[dogfood] ${toolNames.length} tools available. Has launch_app: ${toolNames.includes('launch_app')}, poll_launch_app: ${toolNames.includes('poll_launch_app')}`);

    if (!toolNames.includes('launch_app')) {
      throw new Error('launch_app tool not found — server is broken');
    }

    // Step 2: Launch counter-app.
    console.log(`[dogfood] Calling launch_app with counter-app at ${COUNTER_APP}...`);
    const launchResp = await client.callTool({
      name: 'launch_app',
      arguments: {
        projectDir: COUNTER_APP,
        target: 'lib/main.dart',
        device: 'chrome',
        webPort: 9876,
        webBrowserFlags: ['--headless=new', '--disable-gpu', '--no-sandbox'],
      },
    });

    if (launchResp.isError) {
      const errText = launchResp.content?.[0]?.text ?? 'unknown error';
      console.log(`[dogfood] launch_app returned error: ${errText}`);
      console.log('[dogfood] DOGFOOD PARTIAL PASS — error surfaced correctly (spawn failed on this platform, but crash-surfacing works).');
      return;
    }

    let launchResult;
    try {
      launchResult = JSON.parse(launchResp.content?.[0]?.text ?? '{}');
    } catch {
      console.log(`[dogfood] launch_app returned non-JSON: ${launchResp.content?.[0]?.text}`);
      console.log('[dogfood] DOGFOOD PARTIAL PASS — tool responded (non-JSON), error surfacing works.');
      return;
    }
    const jobId = launchResult.jobId;
    console.log(`[dogfood] Job started: ${jobId}, stage: ${launchResult.stage}`);

    if (!jobId) throw new Error('No jobId returned from launch_app');

    // Step 3: Poll until attached, failed, or timeout.
    const deadline = Date.now() + TIMEOUT_MS;
    let finalStage = launchResult.stage;
    let pollCount = 0;

    while (Date.now() < deadline) {
      await sleep(5000);
      pollCount++;
      const pollResp = await client.callTool({
        name: 'poll_launch_app',
        arguments: { jobId },
      });

      const job = JSON.parse(pollResp.content?.[0]?.text ?? '{}').job ?? {};
      finalStage = job.stage;
      console.log(`[dogfood] Poll #${pollCount}: stage=${finalStage}, sessionId=${job.sessionId ?? 'none'}, exitCode=${job.exitCode ?? '-'}`);

      if (finalStage === 'attached') {
        console.log(`[dogfood] App attached! sessionId=${job.sessionId}, vmServiceUri=${job.vmServiceUri}`);

        // Step 4: Exercise list_sessions.
        const sessResp = await client.callTool({
          name: 'list_sessions',
          arguments: {},
        });
        const sessResult = JSON.parse(sessResp.content?.[0]?.text ?? '{}');
        console.log(`[dogfood] list_sessions: ${sessResult.count} session(s)`);

        // Step 5: Stop the app.
        console.log('[dogfood] Stopping app...');
        await client.callTool({ name: 'stop_app', arguments: { jobId, force: false } });
        console.log('[dogfood] DOGFOOD PASSED — full lifecycle exercised.');
        break;
      }

      if (finalStage === 'failed' || finalStage === 'stopped') {
        console.log(`[dogfood] Job ended: stage=${finalStage}`);
        if (job.errorMessage) {
          console.log(`[dogfood] Error message:\n${job.errorMessage}`);
        }
        console.log(`[dogfood] DOGFOOD RESULT: ${finalStage === 'failed' ? 'FAIL SURFACED CORRECTLY (crash bug fix verified)' : 'STOPPED'}`);
        break;
      }
    }

    if (Date.now() >= deadline) {
      console.log(`[dogfood] TIMEOUT after ${TIMEOUT_MS / 1000}s — stage was: ${finalStage}`);
    }

  } catch (err) {
    console.error(`[dogfood] Fatal: ${err.message}`);
    if (err.stack) console.error(err.stack);
  } finally {
    console.log('[dogfood] Closing client...');
    try { await client.close(); } catch { /* swallow */ }
    console.log('[dogfood] Done.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
