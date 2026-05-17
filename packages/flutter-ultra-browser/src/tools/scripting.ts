import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import type { z } from 'zod';
import { browserManager } from '../browserManager.js';
import type {
  evaluateJsSchema,
  runPlaywrightScriptSchema,
  evalPlaywrightRecipeSchema,
} from '../schemas.js';
import { runPlaywrightScript } from '../sandbox.js';
import type { ToolReturn, ToolContext } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function evaluateJs(args: z.infer<typeof evaluateJsSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);
    // page.evaluate accepts a function or string; string is JSON-safe.
    const result = await rec.page.evaluate(args.expression);
    return ok({ result });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`evaluate_js failed: ${message}`, hint);
  }
}

export async function runPlaywrightScriptTool(
  args: z.infer<typeof runPlaywrightScriptSchema>,
  ctx?: Partial<ToolContext>,
): Promise<ToolReturn> {
  try {
    const pageRec = browserManager.getPage(args.pageId);
    const ctxRec = browserManager.getContext(pageRec.contextId);
    const browserRec = browserManager.getBrowser(ctxRec.browserId);

    const result = await runPlaywrightScript({
      script: args.script,
      page: pageRec.page,
      context: ctxRec.context,
      browser: browserRec.browser,
      options: { wallTimeMs: args.wallTimeMs, cpuKillMs: args.cpuKillMs },
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });
    return ok(result);
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`run_playwright_script failed: ${message}`, hint);
  }
}

function recipesDir(): string {
  // ${CLAUDE_PLUGIN_DATA}/recipes/ per plan §5.4. Fall back to local override.
  return (
    process.env.FLUTTER_ULTRA_RECIPES_DIR ?? join(process.env.FLUTTER_ULTRA_DATA ?? '.', 'recipes')
  );
}

export async function evalPlaywrightRecipe(
  args: z.infer<typeof evalPlaywrightRecipeSchema>,
  ctx?: Partial<ToolContext>,
): Promise<ToolReturn> {
  try {
    const dir = recipesDir();
    // Hardened path resolution against traversal — recipeName is already
    // restricted by Zod regex, but defense in depth.
    const safeName = args.recipeName.replace(/[^a-zA-Z0-9_\-.]/g, '');
    if (safeName !== args.recipeName) {
      return fail(
        `eval_playwright_recipe rejected name '${args.recipeName}'`,
        'Recipe names must match [a-zA-Z0-9_-.]+ exactly.',
      );
    }
    const candidates = ['.ts', '.js', '.mjs'].map((ext) => join(dir, `${safeName}${ext}`));
    const chosen = candidates.find((p) => existsSync(p));
    if (!chosen) {
      return fail(
        `eval_playwright_recipe: no recipe '${safeName}' in ${dir}`,
        `Place a script at ${join(dir, safeName + '.ts')} or set FLUTTER_ULTRA_RECIPES_DIR.`,
      );
    }
    // Re-verify the resolved path is still inside dir (symlink defense).
    const resolved = normalize(chosen);
    const allowedRoot = normalize(dir);
    if (!resolved.startsWith(allowedRoot + sep) && resolved !== allowedRoot) {
      return fail(
        `eval_playwright_recipe: resolved path escapes recipes dir`,
        `Resolved=${resolved}, allowed=${allowedRoot}`,
      );
    }

    const body = await readFile(resolved, 'utf8');
    // Inject params as a `params` const in the sandbox.
    const paramsJson = JSON.stringify(args.params ?? {});
    const wrapped = `const params = ${paramsJson};\n${body}`;

    const pageRec = browserManager.getPage(args.pageId);
    const ctxRec = browserManager.getContext(pageRec.contextId);
    const browserRec = browserManager.getBrowser(ctxRec.browserId);

    const result = await runPlaywrightScript({
      script: wrapped,
      page: pageRec.page,
      context: ctxRec.context,
      browser: browserRec.browser,
      options: { wallTimeMs: args.wallTimeMs },
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });
    return ok({ recipe: safeName, source: resolved, ...result });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`eval_playwright_recipe failed: ${message}`, hint);
  }
}
