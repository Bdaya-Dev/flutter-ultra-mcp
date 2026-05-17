// Widget tree introspection helpers — backs widget_exists / find_widget.
//
// Per AC-R5: must be side-effect-free (no setState fires), return in < 300 ms
// on a 500-node tree, and accept the same FinderSpec gesture/tap accepts.
//
// We call `ext.flutter.inspector.getRootWidgetSummaryTree` which the Flutter
// inspector marks explicitly as read-only; the response is a recursive
// node shape with {type, valueId, children, description, ...} plus optional
// runtimeType / textPreview / shownName / widgetRuntimeType fields.

import { z } from 'zod';
import { matchesText, type FinderSpec, type Rect } from '@flutter-ultra/mcp-runtime';
import type { VmServiceClient } from '@flutter-ultra/vm-service-client';

// We don't actually need the recursive Zod schema in tool code paths (we
// only walk + match in TS), but expose it for callers that want to
// runtime-validate trees from the inspector. The recursive helper below
// is loose-typed via z.ZodTypeAny to avoid Zod 3's inference clash with
// the public `description` field on ZodType.
export const InspectorNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      description: z.string().optional(),
      type: z.string().optional(),
      widgetRuntimeType: z.string().optional(),
      runtimeType: z.string().optional(),
      shownName: z.string().optional(),
      textPreview: z.string().optional(),
      valueId: z.string().optional(),
      keyId: z.string().optional(),
      isStateful: z.boolean().optional(),
      children: z.array(InspectorNodeSchema).optional(),
      // Bounds-related (only present on getDetailsSubtree responses).
      transformToRoot: z.array(z.number()).optional(),
      size: z.tuple([z.number(), z.number()]).optional(),
    })
    .passthrough(),
);

export interface InspectorNode {
  description?: string;
  type?: string;
  widgetRuntimeType?: string;
  runtimeType?: string;
  shownName?: string;
  textPreview?: string;
  valueId?: string;
  keyId?: string;
  isStateful?: boolean;
  children?: InspectorNode[];
  transformToRoot?: number[];
  size?: [number, number];
  [extra: string]: unknown;
}

export interface FoundWidget {
  type?: string;
  runtimeType?: string;
  description?: string;
  keyValue?: string;
  textPreview?: string;
  valueId?: string;
  bounds?: Rect;
  depth: number;
  parentChain: string[];
}

export interface WidgetExistsResult {
  exists: boolean;
  count: number;
  bounds?: Rect[];
  // Top-level node descriptions (for debug context).
  matched: FoundWidget[];
}

const MAX_DEPTH = 256;

export async function fetchSummaryTree(
  client: VmServiceClient,
  isolateId: string,
): Promise<InspectorNode | null> {
  const raw = await client.callServiceExtension('ext.flutter.inspector.getRootWidgetSummaryTree', {
    isolateId,
    args: { groupName: 'flutter-ultra-runtime' },
  });
  if (raw == null || typeof raw !== 'object') return null;
  // The actual tree is at `result` on the response envelope.
  const envelope = raw as Record<string, unknown>;
  const treeRaw = envelope['result'] ?? envelope['tree'] ?? envelope;
  if (treeRaw == null || typeof treeRaw !== 'object') return null;
  const parsed = InspectorNodeSchema.safeParse(treeRaw);
  if (!parsed.success) return null;
  return parsed.data as InspectorNode;
}

// Walk the tree depth-first, calling visitor on each node. Aborts early when
// visitor returns false.
export function walkTree(
  root: InspectorNode,
  visitor: (node: InspectorNode, depth: number, parentChain: string[]) => boolean,
): void {
  const stack: Array<{ node: InspectorNode; depth: number; parent: string[] }> = [
    { node: root, depth: 0, parent: [] },
  ];
  while (stack.length > 0) {
    const { node, depth, parent } = stack.pop()!;
    if (depth > MAX_DEPTH) continue;
    const keepGoing = visitor(node, depth, parent);
    if (!keepGoing) return;
    if (node.children && node.children.length > 0) {
      const myLabel = describeNode(node);
      const nextParent = parent.length < 24 ? [...parent, myLabel] : parent;
      // Push in reverse so the first child is visited first.
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (!child) continue;
        stack.push({ node: child, depth: depth + 1, parent: nextParent });
      }
    }
  }
}

function describeNode(node: InspectorNode): string {
  return (
    node.shownName ??
    node.widgetRuntimeType ??
    node.runtimeType ??
    node.type ??
    node.description ??
    '<unknown>'
  );
}

function nodeKeyValue(node: InspectorNode): string | undefined {
  // Inspector encodes keys various ways across Flutter versions:
  //   - description: "MyWidget-[<'someKey'>]"
  //   - shownName: "MyWidget-[<'someKey'>]"
  //   - keyId on detail nodes
  // We try the description-style first since it's stable on summary trees.
  const sources = [node.description, node.shownName];
  for (const s of sources) {
    if (!s) continue;
    const m = s.match(/-\[<'([^']+)'>\]/);
    if (m && m[1]) return m[1];
    // ValueKey<int>(...) form
    const intMatch = s.match(/-\[<(\d+)>\]/);
    if (intMatch && intMatch[1]) return intMatch[1];
    // GlobalObjectKey form
    const gokey = s.match(/-\[GlobalObjectKey [^\]]+\]/);
    if (gokey) return gokey[0];
  }
  return node.keyId;
}

function nodeType(node: InspectorNode): string | undefined {
  return node.widgetRuntimeType ?? node.runtimeType ?? node.type;
}

function nodeText(node: InspectorNode): string | undefined {
  if (node.textPreview) return node.textPreview;
  // Description often contains the text in quotes for Text widgets.
  if (node.description) {
    const m = node.description.match(/Text\("([^"]+)"\)/);
    if (m && m[1]) return m[1];
  }
  return undefined;
}

function nodeBounds(node: InspectorNode): Rect | undefined {
  if (!node.size || !node.transformToRoot) return undefined;
  const [width, height] = node.size;
  // transformToRoot is a Matrix4 (16 floats, column-major). Translation is
  // entries [12, 13] for a typical 2D layout matrix.
  const tx = node.transformToRoot[12];
  const ty = node.transformToRoot[13];
  if (typeof tx !== 'number' || typeof ty !== 'number') return undefined;
  return { x: tx, y: ty, width, height };
}

export function matchesFinder(node: InspectorNode, spec: FinderSpec): boolean {
  switch (spec.kind) {
    case 'key': {
      const k = nodeKeyValue(node);
      return k === spec.value;
    }
    case 'type': {
      const t = nodeType(node);
      return t === spec.value;
    }
    case 'text': {
      const t = nodeText(node);
      if (t === undefined) return false;
      return matchesText(t, spec);
    }
    case 'semanticsLabel': {
      // Summary tree doesn't carry semantics labels by default — best effort:
      // many widgets surface the label in description. False if absent.
      const d = node.description ?? '';
      const labelMatch = d.match(/semanticsLabel: "([^"]+)"/);
      if (!labelMatch || !labelMatch[1]) return false;
      return matchesText(labelMatch[1], spec);
    }
    case 'tooltip': {
      const d = node.description ?? '';
      const tooltipMatch = d.match(/Tooltip\("([^"]+)"\)/);
      if (!tooltipMatch || !tooltipMatch[1]) return false;
      return matchesText(tooltipMatch[1], spec);
    }
    case 'coords': {
      const b = nodeBounds(node);
      if (!b) return false;
      return spec.x >= b.x && spec.x <= b.x + b.width && spec.y >= b.y && spec.y <= b.y + b.height;
    }
    default:
      return false;
  }
}

export function summarizeNode(
  node: InspectorNode,
  depth: number,
  parentChain: string[],
): FoundWidget {
  const result: FoundWidget = { depth, parentChain };
  const t = nodeType(node);
  if (t !== undefined) result.type = t;
  if (node.runtimeType !== undefined) result.runtimeType = node.runtimeType;
  if (node.description !== undefined) result.description = node.description;
  const k = nodeKeyValue(node);
  if (k !== undefined) result.keyValue = k;
  const text = nodeText(node);
  if (text !== undefined) result.textPreview = text;
  if (node.valueId !== undefined) result.valueId = node.valueId;
  const b = nodeBounds(node);
  if (b !== undefined) result.bounds = b;
  return result;
}

export function findInTree(
  root: InspectorNode,
  spec: FinderSpec,
  options: { limit?: number } = {},
): FoundWidget[] {
  const limit = options.limit ?? 50;
  const found: FoundWidget[] = [];
  walkTree(root, (node, depth, parentChain) => {
    if (matchesFinder(node, spec)) {
      found.push(summarizeNode(node, depth, parentChain));
      if (found.length >= limit) return false;
    }
    return true;
  });
  return found;
}
