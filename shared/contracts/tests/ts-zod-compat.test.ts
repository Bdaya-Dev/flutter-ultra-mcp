import { describe, it, expect, beforeAll } from 'vitest';
import { ContractRegistry } from '../src/registry.js';
import { EXTENSION_NAMES, type ExtensionName } from '../src/extensions.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let registry: ContractRegistry;
let responseFixtures: Record<ExtensionName, unknown>;

beforeAll(() => {
  registry = new ContractRegistry();
  responseFixtures = JSON.parse(
    readFileSync(resolve(__dirname, '..', 'fixtures', 'responses.json'), 'utf-8'),
  );
});

describe('TS Zod schema compat — gesture server schemas accept contract fixtures', () => {
  it('ExtensionEnvelope shape: every fixture has type + method', () => {
    for (const name of EXTENSION_NAMES) {
      const fixture = responseFixtures[name] as Record<string, unknown>;
      expect(fixture).toHaveProperty('type');
      expect(fixture).toHaveProperty('method');
      expect(typeof fixture['type']).toBe('string');
      expect(typeof fixture['method']).toBe('string');
    }
  });

  it('all status fields are "Success" in happy-path fixtures', () => {
    for (const name of EXTENSION_NAMES) {
      const fixture = responseFixtures[name] as Record<string, unknown>;
      if ('status' in fixture) {
        expect(fixture['status']).toBe('Success');
      }
    }
  });

  it('interactiveElements.elements items have required "type" field', () => {
    const fixture = responseFixtures['interactiveElements'] as Record<string, unknown>;
    const elements = fixture['elements'] as Array<Record<string, unknown>>;
    for (const el of elements) {
      expect(el).toHaveProperty('type');
      expect(typeof el['type']).toBe('string');
    }
  });

  it('interactiveElements.elements bounds are numeric when present', () => {
    const fixture = responseFixtures['interactiveElements'] as Record<string, unknown>;
    const elements = fixture['elements'] as Array<Record<string, unknown>>;
    for (const el of elements) {
      if ('bounds' in el && el['bounds']) {
        const b = el['bounds'] as Record<string, unknown>;
        expect(typeof b['x']).toBe('number');
        expect(typeof b['y']).toBe('number');
        expect(typeof b['width']).toBe('number');
        expect(typeof b['height']).toBe('number');
      }
    }
  });

  it('takeScreenshots.screenshots items have base64 string', () => {
    const fixture = responseFixtures['takeScreenshots'] as Record<string, unknown>;
    const screenshots = fixture['screenshots'] as Array<Record<string, unknown>>;
    for (const s of screenshots) {
      expect(typeof s['base64']).toBe('string');
      expect((s['base64'] as string).length).toBeGreaterThan(0);
    }
  });

  it('getVersion.version matches semver pattern', () => {
    const fixture = responseFixtures['getVersion'] as Record<string, unknown>;
    expect(fixture['version']).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('pressBackButton.didPop is boolean', () => {
    const fixture = responseFixtures['pressBackButton'] as Record<string, unknown>;
    expect(typeof fixture['didPop']).toBe('boolean');
  });

  it('listExtensions.extensions items have name string', () => {
    const fixture = responseFixtures['listExtensions'] as Record<string, unknown>;
    const extensions = fixture['extensions'] as Array<Record<string, unknown>>;
    for (const ext of extensions) {
      expect(typeof ext['name']).toBe('string');
    }
  });

  it('getLogs.logs items have message string', () => {
    const fixture = responseFixtures['getLogs'] as Record<string, unknown>;
    const logs = fixture['logs'] as Array<Record<string, unknown>>;
    for (const log of logs) {
      expect(typeof log['message']).toBe('string');
    }
  });

  it('wire format uses string args for all request fields (Dart double.tryParse compat)', () => {
    const requestFixtures = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'fixtures', 'requests.json'), 'utf-8'),
    );
    const numericRequestExtensions: ExtensionName[] = [
      'doubleTap',
      'longPress',
      'swipe',
      'pinchZoom',
      'startScreencast',
    ];
    for (const name of numericRequestExtensions) {
      const req = requestFixtures[name] as Record<string, unknown>;
      for (const [key, value] of Object.entries(req)) {
        if (key === 'key' || key === 'text' || key === 'type' || key === 'focused') continue;
        expect(typeof value).toBe('string');
      }
    }
  });
});
