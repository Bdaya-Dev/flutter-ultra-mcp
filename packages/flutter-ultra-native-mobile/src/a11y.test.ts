import { describe, expect, it } from 'vitest';
import { detectPermissionDialog, findNode, parseUiautomatorXml, walkTree } from './a11y.js';

const SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.example.app" bounds="[0,0][1080,2400]" clickable="false" enabled="true">
    <node index="0" class="android.widget.TextView" resource-id="com.example.app:id/title" text="Hello" content-desc="" bounds="[100,200][980,300]" clickable="true" enabled="true" />
    <node index="1" class="android.widget.Button" resource-id="com.example.app:id/login" text="Sign in" content-desc="Sign in button" bounds="[100,400][980,500]" clickable="true" enabled="true" focused="true" />
  </node>
</hierarchy>`;

const PERMISSION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" package="com.google.android.permissioncontroller" bounds="[0,0][1080,2400]">
    <node index="0" class="android.widget.TextView" text="Allow Example to access photos and media on your device?" bounds="[0,100][1080,200]" />
    <node index="1" class="android.widget.Button" resource-id="com.android.permissioncontroller:id/permission_allow_button" text="Allow" bounds="[200,800][500,900]" clickable="true" />
    <node index="2" class="android.widget.Button" resource-id="com.android.permissioncontroller:id/permission_deny_button" text="Deny" bounds="[600,800][900,900]" clickable="true" />
  </node>
</hierarchy>`;

describe('parseUiautomatorXml', () => {
  it('returns an empty root for empty hierarchy', () => {
    const tree = parseUiautomatorXml('<hierarchy rotation="0"></hierarchy>');
    expect(tree.children).toEqual([]);
  });

  it('parses the canonical UIAutomator tree', () => {
    const tree = parseUiautomatorXml(SIMPLE_XML);
    expect(tree.className).toBe('android.widget.FrameLayout');
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]?.text).toBe('Hello');
    expect(tree.children[1]?.resourceId).toBe('com.example.app:id/login');
    expect(tree.children[1]?.focused).toBe(true);
    expect(tree.children[1]?.bounds).toMatchObject({
      left: 100,
      top: 400,
      right: 980,
      bottom: 500,
      centerX: 540,
      centerY: 450,
      width: 880,
      height: 100,
    });
  });

  it('assigns path indexes for navigation', () => {
    const tree = parseUiautomatorXml(SIMPLE_XML);
    expect(tree.path).toBe('');
    expect(tree.children[0]?.path).toBe('0');
    expect(tree.children[1]?.path).toBe('1');
  });
});

describe('findNode', () => {
  const tree = parseUiautomatorXml(SIMPLE_XML);

  it('matches by text', () => {
    expect(findNode(tree, { text: 'Hello' })?.resourceId).toBe('com.example.app:id/title');
  });

  it('matches by resourceId', () => {
    expect(findNode(tree, { resourceId: 'com.example.app:id/login' })?.text).toBe('Sign in');
  });

  it('matches by textContains', () => {
    expect(findNode(tree, { textContains: 'Sign' })?.text).toBe('Sign in');
  });

  it('matches by contentDesc', () => {
    expect(findNode(tree, { contentDesc: 'Sign in button' })?.resourceId).toBe(
      'com.example.app:id/login',
    );
  });

  it('returns undefined when no match', () => {
    expect(findNode(tree, { text: 'Nothing' })).toBeUndefined();
  });

  it('skips `index` matches before returning', () => {
    // Both children are clickable; matching by className picks both.
    const multi = parseUiautomatorXml(
      `<hierarchy rotation="0">
        <node index="0" class="android.widget.Button" text="A" bounds="[0,0][10,10]" />
        <node index="1" class="android.widget.Button" text="B" bounds="[0,0][10,10]" />
      </hierarchy>`,
    );
    expect(findNode(multi, { className: 'android.widget.Button', index: 0 })?.text).toBe('A');
    expect(findNode(multi, { className: 'android.widget.Button', index: 1 })?.text).toBe('B');
  });
});

describe('walkTree', () => {
  it('visits every node depth-first and stops on truthy return', () => {
    const tree = parseUiautomatorXml(SIMPLE_XML);
    const visited: string[] = [];
    walkTree(tree, (n) => {
      visited.push(n.className ?? '');
      return false;
    });
    expect(visited).toEqual([
      'android.widget.FrameLayout',
      'android.widget.TextView',
      'android.widget.Button',
    ]);
  });

  it('stops walking when visitor returns true', () => {
    const tree = parseUiautomatorXml(SIMPLE_XML);
    const visited: string[] = [];
    walkTree(tree, (n) => {
      visited.push(n.className ?? '');
      return n.className === 'android.widget.TextView';
    });
    expect(visited).toEqual(['android.widget.FrameLayout', 'android.widget.TextView']);
  });
});

describe('detectPermissionDialog', () => {
  it('detects the dialog and locates Allow + Deny by resource-id', () => {
    const tree = parseUiautomatorXml(PERMISSION_XML);
    const shape = detectPermissionDialog(tree);
    expect(shape).toBeDefined();
    expect(shape?.dialogPackage).toBe('com.google.android.permissioncontroller');
    expect(shape?.allow?.text).toBe('Allow');
    expect(shape?.deny?.text).toBe('Deny');
  });

  it('returns undefined when no permission dialog is present', () => {
    const tree = parseUiautomatorXml(SIMPLE_XML);
    expect(detectPermissionDialog(tree)).toBeUndefined();
  });

  it('falls back to text matching when resource-ids are missing', () => {
    const xml = `<hierarchy rotation="0">
      <node index="0" class="android.widget.FrameLayout" package="com.google.android.permissioncontroller" bounds="[0,0][1080,2400]">
        <node index="0" class="android.widget.Button" text="Allow once" bounds="[0,800][500,900]" />
        <node index="1" class="android.widget.Button" text="Don't allow" bounds="[600,800][1080,900]" />
      </node>
    </hierarchy>`;
    const tree = parseUiautomatorXml(xml);
    const shape = detectPermissionDialog(tree);
    expect(shape?.allow?.text).toBe('Allow once');
    expect(shape?.deny?.text).toBe("Don't allow");
  });
});
