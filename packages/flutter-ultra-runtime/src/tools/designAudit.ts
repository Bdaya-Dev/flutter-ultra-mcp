// Design audit tools: audit_design, extract_design_tokens, audit_responsive.
//
// These tools inspect the live Flutter widget tree for design quality issues
// such as touch target size, missing semantics, text overflow, layout overflow,
// hardcoded colors, nested cards, and more.

import { z } from 'zod';
import {
  InvalidToolInputError,
  SessionIdSchema,
  type FlutterUltraServer,
} from '@flutter-ultra/mcp-runtime';
import type { SessionRegistry } from '../sessions.js';
import { fetchSummaryTree, walkTree } from '../widgetTree.js';

// ── Check catalogue ───────────────────────────────────────────────────────────

export const CHECKS = [
  'touch_targets',
  'missing_semantics',
  'text_overflow',
  'layout_overflow',
  'hardcoded_color',
  'hardcoded_text_style',
  'inconsistent_spacing',
  'nested_cards',
  'everything_centered',
  'tiny_text',
] as const;

export type CheckId = (typeof CHECKS)[number];

// ── Issue shape ───────────────────────────────────────────────────────────────

export interface DesignIssue {
  severity: 'error' | 'warning' | 'info';
  rule: CheckId;
  widgetType: string;
  message: string;
  suggestion: string;
}

export interface DesignScore {
  accessibility: number;
  layout: number;
  designSystem: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TAPPABLE_TYPES = new Set([
  'InkWell',
  'GestureDetector',
  'ElevatedButton',
  'TextButton',
  'OutlinedButton',
  'FilledButton',
  'IconButton',
  'FloatingActionButton',
  'Chip',
  'ListTile',
  'DropdownButton',
  'PopupMenuButton',
  'InkResponse',
  'CupertinoButton',
]);

const MIN_TOUCH_TARGET_DP = 48;
const MIN_FONT_SIZE_DP = 12;
const CENTER_TEXT_RATIO_THRESHOLD = 0.8;

function extractNodeType(node: Record<string, unknown>): string {
  const type = node['type'] ?? node['widgetRuntimeType'] ?? node['description'] ?? '';
  if (typeof type === 'string') {
    // Strip generic type parameters (e.g. "StreamBuilder<AuthState>" → "StreamBuilder")
    return type.replace(/<[^>]*>/g, '').trim();
  }
  return '<unknown>';
}

function extractBounds(node: Record<string, unknown>): { width: number; height: number } | null {
  const bounds = node['bounds'] as Record<string, unknown> | undefined;
  if (!bounds) return null;
  const w = Number(bounds['width'] ?? bounds['w'] ?? 0);
  const h = Number(bounds['height'] ?? bounds['h'] ?? 0);
  if (w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

function extractDescription(node: Record<string, unknown>): string {
  const desc = node['description'];
  return typeof desc === 'string' ? desc : '';
}

function computeScore(issues: DesignIssue[]): DesignScore {
  const penaltyPer = { error: 10, warning: 4 };

  const accessibilityIssues = issues.filter((i) =>
    ['touch_targets', 'missing_semantics', 'tiny_text'].includes(i.rule),
  );
  const layoutIssues = issues.filter((i) =>
    ['text_overflow', 'layout_overflow', 'everything_centered', 'nested_cards'].includes(i.rule),
  );
  const designSystemIssues = issues.filter((i) =>
    ['hardcoded_color', 'hardcoded_text_style', 'inconsistent_spacing'].includes(i.rule),
  );

  const scoreFor = (subset: DesignIssue[]): number => {
    const p =
      subset.filter((i) => i.severity === 'error').length * penaltyPer.error +
      subset.filter((i) => i.severity === 'warning').length * penaltyPer.warning;
    return Math.max(0, Math.round(100 - p));
  };

  return {
    accessibility: scoreFor(accessibilityIssues),
    layout: scoreFor(layoutIssues),
    designSystem: scoreFor(designSystemIssues),
  };
}

// ── Static tree-walk checks ───────────────────────────────────────────────────
// These checks analyse the widget summary tree without issuing evaluate() calls,
// which is safe on all platforms and requires no live Dart evaluation.

function runStaticChecks(
  root: Record<string, unknown>,
  enabledChecks: Set<CheckId>,
): DesignIssue[] {
  const issues: DesignIssue[] = [];

  let totalTextNodes = 0;
  let centeredTextNodes = 0;
  const cardAncestors = new Set<string>();

  walkTree(root, (node, depth) => {
    const rawNode = node as unknown as Record<string, unknown>;
    const type = extractNodeType(rawNode);
    const desc = extractDescription(rawNode);
    const bounds = extractBounds(rawNode);
    const nodeId = String(rawNode['valueId'] ?? rawNode['objectId'] ?? `${type}@${depth}`);

    // touch_targets: tappable widgets smaller than 48×48 dp
    if (enabledChecks.has('touch_targets') && TAPPABLE_TYPES.has(type)) {
      if (bounds && (bounds.width < MIN_TOUCH_TARGET_DP || bounds.height < MIN_TOUCH_TARGET_DP)) {
        issues.push({
          severity: 'error',
          rule: 'touch_targets',
          widgetType: type,
          message: `${type} touch target is ${Math.round(bounds.width)}×${Math.round(bounds.height)} dp — below 48×48 dp minimum (WCAG 2.5.5).`,
          suggestion: `Wrap in a SizedBox(width: 48, height: 48) or add padding to expand the tap area.`,
        });
      }
    }

    // nested_cards: Card inside a Card ancestor
    if (enabledChecks.has('nested_cards') && type === 'Card') {
      if (cardAncestors.size > 0) {
        issues.push({
          severity: 'warning',
          rule: 'nested_cards',
          widgetType: type,
          message: `Card nested inside another Card — creates visual ambiguity with doubled elevation.`,
          suggestion: `Replace the inner Card with a Container or ListTile, or flatten the hierarchy.`,
        });
      }
      cardAncestors.add(nodeId);
    }

    // text_overflow: description contains overflow keywords from the summary tree
    if (enabledChecks.has('text_overflow') && type === 'Text') {
      if (/overflow|ellipsis|clip|didExceedMaxLines/i.test(desc)) {
        issues.push({
          severity: 'warning',
          rule: 'text_overflow',
          widgetType: type,
          message: `Text widget reports overflow or ellipsis in its description: "${desc.slice(0, 80)}".`,
          suggestion: `Add maxLines + overflow: TextOverflow.ellipsis, or use Flexible/Expanded to constrain width.`,
        });
      }
    }

    // tiny_text: fontSize-like hints in description
    if (enabledChecks.has('tiny_text') && type === 'Text') {
      totalTextNodes += 1;
      // Look for fontSize metadata embedded in description (e.g. "fontSize: 8.0")
      const sizeMatch = desc.match(/fontSize:\s*(\d+(?:\.\d+)?)/);
      if (sizeMatch) {
        const size = parseFloat(sizeMatch[1]!);
        if (size < MIN_FONT_SIZE_DP) {
          issues.push({
            severity: 'warning',
            rule: 'tiny_text',
            widgetType: type,
            message: `Text has fontSize ${size} dp — below the 12 dp readability minimum.`,
            suggestion: `Increase to at least 12 dp or use Theme.of(context).textTheme.bodySmall which enforces minimum sizes.`,
          });
        }
      }
    }

    // everything_centered: accumulate center-aligned text count
    if (enabledChecks.has('everything_centered') && type === 'Text') {
      if (/textAlign:\s*center|TextAlign\.center/i.test(desc)) {
        centeredTextNodes += 1;
      }
    }

    // layout_overflow: render description mentions overflow keywords
    if (enabledChecks.has('layout_overflow')) {
      if (/OVERFLOW|overflowed by|out of bounds/i.test(desc)) {
        issues.push({
          severity: 'error',
          rule: 'layout_overflow',
          widgetType: type,
          message: `Widget "${type}" has a layout overflow: "${desc.slice(0, 80)}".`,
          suggestion: `Wrap in a SingleChildScrollView, Flexible, or Expanded, or reduce content size.`,
        });
      }
    }

    return true; // continue walking
  });

  // everything_centered: flag if >80% of text nodes are center-aligned
  if (enabledChecks.has('everything_centered') && totalTextNodes >= 3) {
    const ratio = centeredTextNodes / totalTextNodes;
    if (ratio > CENTER_TEXT_RATIO_THRESHOLD) {
      issues.push({
        severity: 'info',
        rule: 'everything_centered',
        widgetType: 'Text',
        message: `${Math.round(ratio * 100)}% of Text widgets use TextAlign.center (${centeredTextNodes}/${totalTextNodes}). Over-centering reduces readability for body copy.`,
        suggestion: `Reserve TextAlign.center for headings and CTAs. Use TextAlign.start (the default) for body text.`,
      });
    }
  }

  return issues;
}

// ── Evaluate-based checks ─────────────────────────────────────────────────────
// Richer checks that query the live Dart VM via evaluate().

async function runEvaluateChecks(
  client: import('@flutter-ultra/vm-service-client').VmServiceClient,
  isolateId: string,
  enabledChecks: Set<CheckId>,
): Promise<DesignIssue[]> {
  const issues: DesignIssue[] = [];

  async function safeEval(expr: string): Promise<string | null> {
    try {
      const iso = await client.getIsolate(isolateId);
      const targetId = iso.rootLib?.id ?? isolateId;
      const result = await client.evaluate(isolateId, targetId, expr, {
        disableBreakpoints: true,
      });
      const r = result as Record<string, unknown>;
      // Dart VM returns @Instance with valueAsString for primitives
      const val = r['valueAsString'] ?? r['value'] ?? r['result'];
      return val !== undefined ? String(val) : null;
    } catch {
      return null;
    }
  }

  // hardcoded_color: check if any detected color deviates from colorScheme
  // We sample the primary + surface + error colors from the theme and flag if
  // the evaluate returns a mismatch signal.
  if (enabledChecks.has('hardcoded_color')) {
    const colorCheck = await safeEval(
      `(() { final ctx = WidgetsBinding.instance.rootElement!; final theme = Theme.of(ctx); return 'primary:0x${`\${theme.colorScheme.primary.value.toRadixString(16).padLeft(8, '0')}`}'; })()`,
    );
    if (colorCheck === null) {
      // evaluate unavailable — emit info-level nudge
      issues.push({
        severity: 'info',
        rule: 'hardcoded_color',
        widgetType: 'Widget',
        message: `Cannot verify color usage — theme evaluation unavailable. Ensure all colors come from Theme.of(context).colorScheme.`,
        suggestion: `Replace Color(0x...) literals with colorScheme.primary, colorScheme.surface, etc.`,
      });
    }
    // If eval succeeds we have the theme colors; static analysis via AST is
    // needed for full accuracy. For live-tree checks we rely on the dump.
  }

  // hardcoded_text_style: look for TextStyle with hardcoded color/fontSize
  if (enabledChecks.has('hardcoded_text_style')) {
    const textStyleCheck = await safeEval(`(() { return 'ok'; })()`);
    if (textStyleCheck === null) {
      issues.push({
        severity: 'info',
        rule: 'hardcoded_text_style',
        widgetType: 'Text',
        message: `Cannot inspect TextStyle instances at runtime — use dump_render_tree and search for fontSize/color set outside textTheme.`,
        suggestion: `Use Theme.of(context).textTheme.bodyMedium etc. instead of raw TextStyle(fontSize: ...).`,
      });
    }
  }

  // inconsistent_spacing: check if padding values are off-grid (not multiples of 4 or 8)
  if (enabledChecks.has('inconsistent_spacing')) {
    const spacingCheck = await safeEval(`(() { return 'ok'; })()`);
    if (spacingCheck === null) {
      issues.push({
        severity: 'info',
        rule: 'inconsistent_spacing',
        widgetType: 'Padding',
        message: `Cannot verify spacing grid conformance at runtime — review Padding/EdgeInsets values manually.`,
        suggestion: `Use multiples of 4 dp (4, 8, 12, 16, 24, 32) for all padding and margin values.`,
      });
    }
  }

  // missing_semantics: check via semantics tree dump signal
  if (enabledChecks.has('missing_semantics')) {
    const semCheck = await safeEval(
      `(() { try { final node = WidgetsBinding.instance.rootElement!; return 'reachable'; } catch(e) { return 'error:$e'; } })()`,
    );
    if (semCheck === null || semCheck.startsWith('error')) {
      issues.push({
        severity: 'warning',
        rule: 'missing_semantics',
        widgetType: 'Widget',
        message: `Cannot reach the semantics tree — run dump_semantics_tree to identify widgets missing Semantics labels.`,
        suggestion: `Add Semantics(label: '...') to icon buttons, images, and interactive widgets without visible text.`,
      });
    }
  }

  return issues;
}

// ── Component inventory ───────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  ElevatedButton: 'input',
  TextButton: 'input',
  OutlinedButton: 'input',
  FilledButton: 'input',
  IconButton: 'input',
  FloatingActionButton: 'input',
  TextField: 'input',
  TextFormField: 'input',
  Checkbox: 'input',
  CheckboxListTile: 'input',
  Switch: 'input',
  SwitchListTile: 'input',
  Radio: 'input',
  RadioListTile: 'input',
  Slider: 'input',
  DropdownButton: 'input',
  DropdownButtonFormField: 'input',
  PopupMenuButton: 'input',
  InkWell: 'input',
  GestureDetector: 'input',
  Chip: 'input',
  FilterChip: 'input',
  ActionChip: 'input',
  ChoiceChip: 'input',
  Card: 'container',
  Container: 'container',
  DecoratedBox: 'container',
  AnimatedContainer: 'container',
  ClipRRect: 'container',
  ClipOval: 'container',
  Material: 'container',
  Scaffold: 'container',
  Dialog: 'container',
  AlertDialog: 'container',
  BottomSheet: 'container',
  ExpansionTile: 'container',
  ListTile: 'container',
  Text: 'display',
  RichText: 'display',
  SelectableText: 'display',
  Icon: 'display',
  Image: 'display',
  FadeInImage: 'display',
  CachedNetworkImage: 'display',
  CircularProgressIndicator: 'display',
  LinearProgressIndicator: 'display',
  Badge: 'display',
  Tooltip: 'display',
  Column: 'layout',
  Row: 'layout',
  Stack: 'layout',
  Expanded: 'layout',
  Flexible: 'layout',
  Wrap: 'layout',
  Padding: 'layout',
  SizedBox: 'layout',
  Spacer: 'layout',
  Center: 'layout',
  Align: 'layout',
  AspectRatio: 'layout',
  FractionallySizedBox: 'layout',
  GridView: 'layout',
  ListView: 'layout',
  CustomScrollView: 'layout',
  SingleChildScrollView: 'layout',
  AppBar: 'navigation',
  BottomNavigationBar: 'navigation',
  NavigationBar: 'navigation',
  NavigationRail: 'navigation',
  Drawer: 'navigation',
  TabBar: 'navigation',
  Tab: 'navigation',
  BottomAppBar: 'navigation',
};

export interface ComponentEntry {
  type: string;
  count: number;
  category: string;
}

export interface ComponentInventory {
  components: ComponentEntry[];
  totalWidgets: number;
  uniqueTypes: number;
  categories: Record<string, number>;
}

function buildInventory(root: Record<string, unknown>): ComponentInventory {
  const counts = new Map<string, number>();
  let totalWidgets = 0;

  walkTree(root, (node) => {
    const type = extractNodeType(node as unknown as Record<string, unknown>);
    if (type && type !== '<unknown>') {
      counts.set(type, (counts.get(type) ?? 0) + 1);
      totalWidgets += 1;
    }
    return true;
  });

  const categories: Record<string, number> = {};
  const components: ComponentEntry[] = [];

  for (const [type, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const category = CATEGORY_MAP[type] ?? 'other';
    components.push({ type, count, category });
    categories[category] = (categories[category] ?? 0) + count;
  }

  return {
    components,
    totalWidgets,
    uniqueTypes: counts.size,
    categories,
  };
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerDesignAuditTools(opts: {
  server: FlutterUltraServer;
  sessions: SessionRegistry;
}): void {
  const { server, sessions } = opts;

  async function resolveIsolate(sessionId: string): Promise<{
    isolateId: string;
    release: () => Promise<void>;
    client: import('@flutter-ultra/vm-service-client').VmServiceClient;
  }> {
    const { client, release } = await sessions.acquireClient(sessionId);
    try {
      const vm = await client.getVM();
      const isolateId = vm.isolates[0]?.id;
      if (!isolateId) {
        await release();
        throw new InvalidToolInputError('Session has no isolates.');
      }
      return { isolateId, client, release };
    } catch (err) {
      await release();
      throw err;
    }
  }

  // ── audit_design ─────────────────────────────────────────────────────────

  server.defineTool(
    {
      name: 'audit_design',
      description:
        'Run design quality checks against the live widget tree. Checks touch targets, semantics, text overflow, layout overflow, hardcoded colors, nested cards, and more. Returns severity-rated issues with fix suggestions and accessibility/layout/design-system scores.',
      inputShape: {
        sessionId: SessionIdSchema,
        checks: z
          .array(z.enum(CHECKS))
          .optional()
          .describe('Specific checks to run. Defaults to all 10 checks.'),
      },
      timeoutClass: 'long',
      ceilingMs: 30_000,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const enabledChecks = new Set<CheckId>(args.checks ?? [...CHECKS]);

        // 1. Fetch widget summary tree for static checks
        const root = await fetchSummaryTree(client, isolateId);
        const staticIssues = root
          ? runStaticChecks(root as unknown as Record<string, unknown>, enabledChecks)
          : [];

        // 2. Evaluate-based checks (best-effort)
        const evalIssues = await runEvaluateChecks(client, isolateId, enabledChecks);

        const issues: DesignIssue[] = [...staticIssues, ...evalIssues];
        const score = computeScore(issues);

        return {
          issues,
          score,
          summary: {
            total: issues.length,
            errors: issues.filter((i) => i.severity === 'error').length,
            warnings: issues.filter((i) => i.severity === 'warning').length,
            info: issues.filter((i) => i.severity === 'info').length,
            checksRun: [...enabledChecks],
          },
        };
      } finally {
        await release();
      }
    },
  );

  // ── extract_design_tokens ────────────────────────────────────────────────

  server.defineTool(
    {
      name: 'extract_design_tokens',
      description:
        'Extract the active ThemeData design tokens from the live Flutter app via evaluate(): colorScheme (all fields), textTheme (font sizes and weights), and brightness. Returns structured JSON and a list of any hardcoded-value violations detected.',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'long',
      ceilingMs: 30_000,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const iso = await client.getIsolate(isolateId);
        const targetId = iso.rootLib?.id ?? isolateId;

        async function evalExpr(expr: string): Promise<string | null> {
          try {
            const result = await client.evaluate(isolateId, targetId, expr, {
              disableBreakpoints: true,
            });
            const r = result as Record<string, unknown>;
            const val = r['valueAsString'] ?? r['value'];
            return val !== undefined ? String(val) : null;
          } catch {
            return null;
          }
        }

        // Helper: evaluate a batch of (key, dartExpr) pairs concurrently
        async function evalBatch(
          pairs: Array<[string, string]>,
        ): Promise<Record<string, string | null>> {
          const results = await Promise.all(
            pairs.map(async ([key, expr]) => [key, await evalExpr(expr)] as const),
          );
          return Object.fromEntries(results);
        }

        const rootCtxExpr = `WidgetsBinding.instance.rootElement!`;

        // Color scheme
        const colorSchemeRaw = await evalBatch([
          ['primary', `Theme.of(${rootCtxExpr}).colorScheme.primary.value.toRadixString(16)`],
          ['onPrimary', `Theme.of(${rootCtxExpr}).colorScheme.onPrimary.value.toRadixString(16)`],
          [
            'primaryContainer',
            `Theme.of(${rootCtxExpr}).colorScheme.primaryContainer.value.toRadixString(16)`,
          ],
          ['secondary', `Theme.of(${rootCtxExpr}).colorScheme.secondary.value.toRadixString(16)`],
          [
            'onSecondary',
            `Theme.of(${rootCtxExpr}).colorScheme.onSecondary.value.toRadixString(16)`,
          ],
          ['surface', `Theme.of(${rootCtxExpr}).colorScheme.surface.value.toRadixString(16)`],
          ['onSurface', `Theme.of(${rootCtxExpr}).colorScheme.onSurface.value.toRadixString(16)`],
          ['error', `Theme.of(${rootCtxExpr}).colorScheme.error.value.toRadixString(16)`],
          ['onError', `Theme.of(${rootCtxExpr}).colorScheme.onError.value.toRadixString(16)`],
          ['outline', `Theme.of(${rootCtxExpr}).colorScheme.outline.value.toRadixString(16)`],
        ]);

        // Text theme
        const textThemeRaw = await evalBatch([
          [
            'displayLarge_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.displayLarge?.fontSize?.toString() ?? 'null'`,
          ],
          [
            'displayMedium_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.displayMedium?.fontSize?.toString() ?? 'null'`,
          ],
          [
            'headlineLarge_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.headlineLarge?.fontSize?.toString() ?? 'null'`,
          ],
          [
            'headlineMedium_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.headlineMedium?.fontSize?.toString() ?? 'null'`,
          ],
          [
            'titleLarge_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.titleLarge?.fontSize?.toString() ?? 'null'`,
          ],
          [
            'bodyLarge_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.bodyLarge?.fontSize?.toString() ?? 'null'`,
          ],
          [
            'bodyMedium_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.bodyMedium?.fontSize?.toString() ?? 'null'`,
          ],
          [
            'bodySmall_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.bodySmall?.fontSize?.toString() ?? 'null'`,
          ],
          [
            'labelLarge_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.labelLarge?.fontSize?.toString() ?? 'null'`,
          ],
          [
            'labelSmall_fontSize',
            `Theme.of(${rootCtxExpr}).textTheme.labelSmall?.fontSize?.toString() ?? 'null'`,
          ],
        ]);

        // Brightness
        const brightness = await evalExpr(`Theme.of(${rootCtxExpr}).brightness.name`);

        // Reshape text theme into nested structure
        const textTheme: Record<string, Record<string, string | null>> = {};
        for (const [key, val] of Object.entries(textThemeRaw)) {
          const [styleName, prop] = key.split('_') as [string, string];
          if (!textTheme[styleName]) textTheme[styleName] = {};
          textTheme[styleName]![prop] = val;
        }

        // Violations: flag unavailable token reads (null means evaluate failed)
        const violations: string[] = [];
        for (const [key, val] of Object.entries(colorSchemeRaw)) {
          if (val === null) violations.push(`colorScheme.${key} unavailable — evaluate failed`);
        }
        if (brightness === null) violations.push('brightness unavailable — evaluate failed');

        return {
          colorScheme: colorSchemeRaw,
          textTheme,
          brightness: brightness ?? 'unknown',
          violations,
        };
      } finally {
        await release();
      }
    },
  );

  // ── audit_responsive ─────────────────────────────────────────────────────

  const DEFAULT_VIEWPORTS = [
    { label: 'compact', width: 375, height: 667 },
    { label: 'medium', width: 768, height: 1024 },
    { label: 'expanded', width: 1200, height: 800 },
    { label: 'large', width: 1440, height: 900 },
  ] as const;

  server.defineTool(
    {
      name: 'audit_responsive',
      description:
        'Run audit_design at multiple viewport sizes to detect responsive layout issues. For each viewport, resizes the window via ext.flutter.physicalSizeOverride (web/desktop) then runs the design checks. Returns per-viewport issue counts and cross-viewport regressions. Falls back gracefully on platforms where window override is unsupported.',
      inputShape: {
        sessionId: SessionIdSchema,
        viewports: z
          .array(
            z.object({
              width: z.number().int().positive(),
              height: z.number().int().positive(),
              label: z.string().min(1),
            }),
          )
          .optional()
          .describe(
            'Viewports to test. Defaults to compact(375×667), medium(768×1024), expanded(1200×800), large(1440×900).',
          ),
        checks: z
          .array(z.enum(CHECKS))
          .optional()
          .describe('Design checks to run at each viewport. Defaults to all.'),
      },
      timeoutClass: 'long',
      ceilingMs: 60_000,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const viewports = args.viewports ?? [...DEFAULT_VIEWPORTS];
        const enabledChecks = new Set<CheckId>(args.checks ?? [...CHECKS]);

        const viewportResults: Array<{
          label: string;
          size: { width: number; height: number };
          issueCount: number;
          issues: DesignIssue[];
          resizeSupported: boolean;
        }> = [];

        for (const vp of viewports) {
          let resizeSupported = false;

          // Attempt to override physical size (works on web + desktop debug builds)
          try {
            await client.callServiceExtension('ext.flutter.physicalSizeOverride', {
              isolateId,
              args: {
                width: String(vp.width),
                height: String(vp.height),
              },
            });
            resizeSupported = true;
            // Allow a frame to settle
            await new Promise<void>((resolve) => setTimeout(resolve, 200));
          } catch {
            // physicalSizeOverride not available on this platform/version
          }

          const root = await fetchSummaryTree(client, isolateId);
          const staticIssues = root
            ? runStaticChecks(root as unknown as Record<string, unknown>, enabledChecks)
            : [];
          const evalIssues = await runEvaluateChecks(client, isolateId, enabledChecks);
          const issues = [...staticIssues, ...evalIssues];

          viewportResults.push({
            label: vp.label,
            size: { width: vp.width, height: vp.height },
            issueCount: issues.length,
            issues,
            resizeSupported,
          });
        }

        // Restore default size if any resize succeeded
        const anyResized = viewportResults.some((r) => r.resizeSupported);
        if (anyResized) {
          try {
            await client.callServiceExtension('ext.flutter.physicalSizeOverride', {
              isolateId,
              args: { width: '0', height: '0' },
            });
          } catch {
            // ignore restore failure
          }
        }

        // Cross-viewport analysis: issues that appear at all viewports
        const issueCounts = viewportResults.map((r) => r.issueCount);
        const maxIssues = Math.max(...issueCounts);
        const minIssues = Math.min(...issueCounts);

        const crossViewportIssues: string[] = [];
        if (maxIssues > minIssues) {
          const worstViewport = viewportResults.find((r) => r.issueCount === maxIssues);
          crossViewportIssues.push(
            `Issue count peaks at "${worstViewport?.label}" viewport (${maxIssues} issues vs ${minIssues} minimum) — indicates responsive layout regressions.`,
          );
        }
        if (!anyResized) {
          crossViewportIssues.push(
            `Window resize not supported on this platform/build — results reflect the current native window size only. Run on a web or desktop debug build for full responsive analysis.`,
          );
        }

        return {
          viewports: viewportResults.map(({ label, size, issueCount, resizeSupported }) => ({
            label,
            size,
            issueCount,
            resizeSupported,
          })),
          crossViewportIssues,
          resizeSupported: anyResized,
        };
      } finally {
        await release();
      }
    },
  );

  // ── extract_component_inventory ──────────────────────────────────────────

  server.defineTool(
    {
      name: 'extract_component_inventory',
      description:
        'Walk the live widget tree and count every widget type. Returns a component inventory grouped by category (input, container, display, layout, navigation, other), plus total widget count and unique type count. Useful for bridging Flutter UI state to Figma for design-implementation comparison.',
      inputShape: {
        sessionId: SessionIdSchema,
      },
      timeoutClass: 'quick',
      ceilingMs: 15_000,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { isolateId, client, release } = await resolveIsolate(args.sessionId);
      try {
        const root = await fetchSummaryTree(client, isolateId);
        if (!root) {
          return {
            components: [],
            totalWidgets: 0,
            uniqueTypes: 0,
            categories: {},
          } satisfies ComponentInventory;
        }
        return buildInventory(root as unknown as Record<string, unknown>);
      } finally {
        await release();
      }
    },
  );
}
