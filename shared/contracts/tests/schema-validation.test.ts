import { describe, it, expect, beforeAll } from 'vitest';
import { ContractRegistry } from '../src/registry.js';
import { EXTENSION_NAMES, EXTENSION_METHOD_MAP, type ExtensionName } from '../src/extensions.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '..', 'fixtures');

let registry: ContractRegistry;
let responseFixtures: Record<string, unknown>;
let requestFixtures: Record<string, unknown>;

beforeAll(() => {
  registry = new ContractRegistry();
  responseFixtures = JSON.parse(readFileSync(resolve(fixturesDir, 'responses.json'), 'utf-8'));
  requestFixtures = JSON.parse(readFileSync(resolve(fixturesDir, 'requests.json'), 'utf-8'));
});

describe('Contract registry loads all 16 extensions', () => {
  it('has exactly 16 extension schemas', () => {
    expect(registry.all()).toHaveLength(16);
  });

  it('every EXTENSION_NAMES entry is loadable', () => {
    for (const name of EXTENSION_NAMES) {
      expect(() => registry.get(name)).not.toThrow();
    }
  });

  it('each schema has a method matching the EXTENSION_METHOD_MAP', () => {
    for (const name of EXTENSION_NAMES) {
      const contract = registry.get(name);
      expect(contract.method).toBe(EXTENSION_METHOD_MAP[name]);
    }
  });
});

describe('Response fixture validation (happy path)', () => {
  for (const name of EXTENSION_NAMES) {
    it(`${name}: fixture validates against schema`, () => {
      const fixture = (responseFixtures as Record<string, unknown>)[name];
      expect(fixture).toBeDefined();
      const result = registry.validateResponse(name, fixture);
      expect(result.valid).toBe(true);
      if (!result.valid) {
        expect(result.errors).toEqual([]);
      }
    });
  }
});

describe('Request fixture validation (happy path)', () => {
  for (const name of EXTENSION_NAMES) {
    it(`${name}: request fixture validates against request schema`, () => {
      const fixture = (requestFixtures as Record<string, unknown>)[name];
      expect(fixture).toBeDefined();
      const result = registry.validateRequest(name, fixture);
      expect(result.valid).toBe(true);
      if (!result.valid) {
        expect(result.errors).toEqual([]);
      }
    });
  }
});

describe('Response rejection (negative cases)', () => {
  it('rejects getVersion with missing version field', () => {
    const bad = {
      type: '_extensionType',
      method: 'ext.flutter.ultra.getVersion',
      status: 'Success',
    };
    const result = registry.validateResponse('getVersion', bad);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects interactiveElements with elements as string', () => {
    const bad = {
      type: '_extensionType',
      method: 'ext.flutter.ultra.interactiveElements',
      status: 'Success',
      elements: 'not-an-array',
    };
    const result = registry.validateResponse('interactiveElements', bad);
    expect(result.valid).toBe(false);
  });

  it('rejects takeScreenshots with screenshots missing base64', () => {
    const bad = {
      type: '_extensionType',
      method: 'ext.flutter.ultra.takeScreenshots',
      status: 'Success',
      screenshots: [{ viewId: 0, width: 1, height: 1 }],
    };
    const result = registry.validateResponse('takeScreenshots', bad);
    expect(result.valid).toBe(false);
  });

  it('rejects pressBackButton with didPop as string', () => {
    const bad = {
      type: '_extensionType',
      method: 'ext.flutter.ultra.pressBackButton',
      status: 'Success',
      didPop: 'true',
    };
    const result = registry.validateResponse('pressBackButton', bad);
    expect(result.valid).toBe(false);
  });

  it('rejects getLogs with logs missing message field', () => {
    const bad = {
      type: '_extensionType',
      method: 'ext.flutter.ultra.getLogs',
      status: 'Success',
      logs: [{ level: 'info' }],
    };
    const result = registry.validateResponse('getLogs', bad);
    expect(result.valid).toBe(false);
  });

  it('rejects listExtensions with extensions missing name', () => {
    const bad = {
      type: '_extensionType',
      method: 'ext.flutter.ultra.listExtensions',
      status: 'Success',
      extensions: [{ description: 'no name' }],
    };
    const result = registry.validateResponse('listExtensions', bad);
    expect(result.valid).toBe(false);
  });
});

describe('Request rejection (negative cases)', () => {
  it('rejects enterText without required input field', () => {
    const bad = { key: 'email_field' };
    const result = registry.validateRequest('enterText', bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('input'))).toBe(true);
  });

  it('rejects pinchZoom without required scale field', () => {
    const bad = { key: 'map_view' };
    const result = registry.validateRequest('pinchZoom', bad);
    expect(result.valid).toBe(false);
  });
});
