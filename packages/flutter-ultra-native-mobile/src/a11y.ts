// A11y tree parser — UIAutomator XML dumps for Android.
//
// UIAutomator dump produces XML with <node> elements; we walk it into a
// structured tree the agent can match against (text, content-desc, class,
// resource-id, bounds, focused). iOS XCUITest produces plist/JSON; we
// stub the surface here and the iOS tools build the same shape so callers
// don't branch on platform.

import { XMLParser } from 'fast-xml-parser';

export interface A11yBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface A11yNode {
  path: string; // index path like "0/2/1" for navigation
  className?: string;
  resourceId?: string;
  contentDesc?: string;
  text?: string;
  packageName?: string;
  bounds?: A11yBounds;
  // Booleans surfaced as flags so a finder spec stays compact.
  clickable?: boolean;
  longClickable?: boolean;
  enabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  checked?: boolean;
  scrollable?: boolean;
  password?: boolean;
  // Children walked recursively.
  children: A11yNode[];
}

const BOUNDS_RE = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/;

function parseBounds(raw: string | undefined): A11yBounds | undefined {
  if (!raw) return undefined;
  const m = BOUNDS_RE.exec(raw);
  if (!m) return undefined;
  const left = Number(m[1]);
  const top = Number(m[2]);
  const right = Number(m[3]);
  const bottom = Number(m[4]);
  return {
    left,
    top,
    right,
    bottom,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
    width: right - left,
    height: bottom - top,
  };
}

function boolAttr(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

// Parse the XML emitted by `uiautomator dump`. The top element is
// <hierarchy rotation="..."><node ...>...</node></hierarchy>.
export function parseUiautomatorXml(xml: string): A11yNode {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    isArray: (name) => name === 'node',
  });
  const tree = parser.parse(xml) as Record<string, unknown>;
  const hierarchy = tree.hierarchy as Record<string, unknown> | undefined;
  if (!hierarchy) {
    return { path: '', children: [] };
  }
  const rootNodes = hierarchy.node as Record<string, unknown>[] | undefined;
  if (!rootNodes || rootNodes.length === 0) {
    return { path: '', children: [] };
  }
  // Hierarchy may have multiple top-level nodes (multi-window). Wrap them
  // under a synthetic root.
  if (rootNodes.length === 1 && rootNodes[0]) {
    return walk(rootNodes[0], '');
  }
  return {
    path: '',
    children: rootNodes
      .filter((n): n is Record<string, unknown> => !!n)
      .map((n, i) => walk(n, String(i))),
  };
}

function walk(raw: Record<string, unknown>, path: string): A11yNode {
  const get = (k: string): string | undefined => {
    const v = raw[`@_${k}`];
    return typeof v === 'string' ? v : undefined;
  };
  const childRaw = (raw.node as Record<string, unknown>[] | undefined) ?? [];
  const node: A11yNode = {
    path,
    children: childRaw.map((c, i) => walk(c, path === '' ? String(i) : `${path}/${i}`)),
  };
  const className = get('class');
  if (className !== undefined) node.className = className;
  const resourceId = get('resource-id');
  if (resourceId !== undefined && resourceId.length > 0) node.resourceId = resourceId;
  const contentDesc = get('content-desc');
  if (contentDesc !== undefined && contentDesc.length > 0) node.contentDesc = contentDesc;
  const text = get('text');
  if (text !== undefined && text.length > 0) node.text = text;
  const packageName = get('package');
  if (packageName !== undefined) node.packageName = packageName;
  const bounds = parseBounds(get('bounds'));
  if (bounds) node.bounds = bounds;
  const clickable = boolAttr(get('clickable'));
  if (clickable !== undefined) node.clickable = clickable;
  const longClickable = boolAttr(get('long-clickable'));
  if (longClickable !== undefined) node.longClickable = longClickable;
  const enabled = boolAttr(get('enabled'));
  if (enabled !== undefined) node.enabled = enabled;
  const focused = boolAttr(get('focused'));
  if (focused !== undefined) node.focused = focused;
  const selected = boolAttr(get('selected'));
  if (selected !== undefined) node.selected = selected;
  const checked = boolAttr(get('checked'));
  if (checked !== undefined) node.checked = checked;
  const scrollable = boolAttr(get('scrollable'));
  if (scrollable !== undefined) node.scrollable = scrollable;
  const password = boolAttr(get('password'));
  if (password !== undefined) node.password = password;
  return node;
}

// ---------------------------------------------------------------------------
// iOS WDA (WebDriverAgent) accessibility tree parser.
//
// WDA /source returns XML whose root element is <AppiumAUT> or <XCUIElementTypeApplication>.
// Each element carries attributes: type, name, label, value, enabled, visible,
// accessible, x, y, width, height. Children are nested elements of the same form.
//
// We map this to the same A11yNode shape as UIAutomator so callers are platform-agnostic.
// ---------------------------------------------------------------------------

export function parseWdaSourceXml(xml: string): A11yNode {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    // All element type names are valid child names — treat every tag as an array.
    isArray: () => true,
  });
  const tree = parser.parse(xml) as Record<string, unknown>;

  // WDA wraps content in either <AppiumAUT> or the root XCUIElement type.
  // Pick the first top-level element that isn't empty.
  const topKey = Object.keys(tree).find((k) => k !== '?xml' && tree[k]);
  if (!topKey) return { path: '', children: [] };

  const topVal = tree[topKey];
  const rootArray = Array.isArray(topVal) ? topVal : [topVal];
  const rootRaw = rootArray[0] as Record<string, unknown> | undefined;
  if (!rootRaw) return { path: '', children: [] };

  return walkWda(rootRaw, topKey, '');
}

function walkWda(raw: Record<string, unknown>, tagName: string, path: string): A11yNode {
  const get = (k: string): string | undefined => {
    const v = raw[`@_${k}`];
    return typeof v === 'string' ? v : undefined;
  };

  // Collect child elements: every key that doesn't start with @_ and is an array.
  const children: A11yNode[] = [];
  let childIdx = 0;
  for (const key of Object.keys(raw)) {
    if (key.startsWith('@_')) continue;
    const childItems = raw[key];
    if (!Array.isArray(childItems)) continue;
    for (const item of childItems) {
      if (item === null || typeof item !== 'object') continue;
      const childPath = path === '' ? String(childIdx) : `${path}/${String(childIdx)}`;
      children.push(walkWda(item as Record<string, unknown>, key, childPath));
      childIdx += 1;
    }
  }

  const node: A11yNode = { path, children };

  // WDA uses XCUIElementType* as class names.
  const typeName = get('type') ?? tagName;
  if (typeName) node.className = typeName;

  // `name` maps to resourceId (accessibility identifier in XCUITest).
  const name = get('name');
  if (name && name.length > 0) node.resourceId = name;

  // `label` is the human-visible text (accessibility label).
  const label = get('label');
  if (label && label.length > 0) node.contentDesc = label;

  // `value` is the current value of controls (text field content, slider pos).
  const value = get('value');
  if (value && value.length > 0) node.text = value;

  // Booleans.
  const enabled = get('enabled');
  if (enabled !== undefined) node.enabled = enabled === 'true';
  const visible = get('visible');
  // Map visible → focused (closest semantic equivalent for display purposes).
  if (visible !== undefined) node.focused = visible === 'true';
  const accessible = get('accessible');
  if (accessible !== undefined) node.clickable = accessible === 'true';

  // Bounds from x/y/width/height attributes.
  const x = get('x');
  const y = get('y');
  const w = get('width');
  const h = get('height');
  if (x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
    const left = Number(x);
    const top = Number(y);
    const width = Number(w);
    const height = Number(h);
    node.bounds = {
      left,
      top,
      right: left + width,
      bottom: top + height,
      centerX: Math.round(left + width / 2),
      centerY: Math.round(top + height / 2),
      width,
      height,
    };
  }

  return node;
}

export interface FinderSpec {
  // At least one must be provided.
  text?: string;
  textContains?: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  index?: number; // pick the Nth match
}

// Depth-first match. Returns the first node satisfying ALL specified
// criteria, after optionally skipping `index` matches.
export function findNode(root: A11yNode, finder: FinderSpec): A11yNode | undefined {
  let skip = finder.index ?? 0;
  let result: A11yNode | undefined;
  walkTree(root, (n) => {
    if (!matches(n, finder)) return false;
    if (skip > 0) {
      skip -= 1;
      return false;
    }
    result = n;
    return true; // stop walking
  });
  return result;
}

// Walk every node; visitor returning true stops the traversal.
export function walkTree(root: A11yNode, visit: (n: A11yNode) => boolean): boolean {
  if (visit(root)) return true;
  for (const c of root.children) {
    if (walkTree(c, visit)) return true;
  }
  return false;
}

function matches(n: A11yNode, f: FinderSpec): boolean {
  if (f.text !== undefined && n.text !== f.text) return false;
  if (f.textContains !== undefined) {
    if (!n.text || !n.text.includes(f.textContains)) return false;
  }
  if (f.resourceId !== undefined && n.resourceId !== f.resourceId) return false;
  if (f.contentDesc !== undefined && n.contentDesc !== f.contentDesc) return false;
  if (f.className !== undefined && n.className !== f.className) return false;
  return true;
}

// "Are we looking at a runtime permission system dialog?" heuristic.
// Returns the matching node + the recommended allow/deny button. The
// common Android permission package is com.google.android.permissioncontroller
// (post-P) or com.android.packageinstaller (pre-P).
export interface PermissionDialogShape {
  dialogPackage: string;
  allow?: A11yNode;
  deny?: A11yNode;
}

export function detectPermissionDialog(root: A11yNode): PermissionDialogShape | undefined {
  const candidates: A11yNode[] = [];
  walkTree(root, (n) => {
    if (
      n.packageName === 'com.google.android.permissioncontroller' ||
      n.packageName === 'com.android.packageinstaller' ||
      n.packageName === 'com.android.permissioncontroller'
    ) {
      candidates.push(n);
    }
    return false;
  });
  if (candidates.length === 0) return undefined;
  const first = candidates[0]!;
  const shape: PermissionDialogShape = { dialogPackage: first.packageName ?? '' };
  // The exact ids vary across Android versions; use both id and text matchers.
  const allowIds = [
    'com.android.permissioncontroller:id/permission_allow_button',
    'com.android.permissioncontroller:id/permission_allow_one_time_button',
    'com.android.permissioncontroller:id/permission_allow_foreground_only_button',
    'com.android.packageinstaller:id/permission_allow_button',
  ];
  const denyIds = [
    'com.android.permissioncontroller:id/permission_deny_button',
    'com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button',
    'com.android.packageinstaller:id/permission_deny_button',
  ];
  const allowTexts = ['Allow', 'Allow only while using the app', 'Allow once', 'While using app'];
  const denyTexts = ['Deny', "Don't allow", 'Deny & don’t ask again'];

  for (const c of candidates) {
    walkTree(c, (n) => {
      if (!shape.allow) {
        if (
          (n.resourceId && allowIds.includes(n.resourceId)) ||
          (n.text && allowTexts.includes(n.text))
        ) {
          shape.allow = n;
        }
      }
      if (!shape.deny) {
        if (
          (n.resourceId && denyIds.includes(n.resourceId)) ||
          (n.text && denyTexts.includes(n.text))
        ) {
          shape.deny = n;
        }
      }
      return false;
    });
  }
  return shape;
}
