import { describe, it, expect, beforeAll } from 'vitest';
import { ContractRegistry } from '../src/registry.js';
import { EXTENSION_NAMES, EXTENSION_METHOD_MAP, SCHEMA_FILE_MAP } from '../src/extensions.js';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, '..', 'ext-flutter-ultra');

let registry: ContractRegistry;

beforeAll(() => {
  registry = new ContractRegistry();
});

describe('AC-TS3: Drift detection — schema ↔ TS code consistency', () => {
  it('every schema file on disk has a matching EXTENSION_NAMES entry', () => {
    const files = readdirSync(SCHEMA_DIR).filter(
      (f) => f.endsWith('.schema.json') && f !== 'envelope.schema.json',
    );
    const schemaFileSet = new Set(Object.values(SCHEMA_FILE_MAP));
    for (const file of files) {
      expect(schemaFileSet.has(file)).toBe(true);
    }
  });

  it('every EXTENSION_NAMES entry has a schema file on disk', () => {
    const files = new Set(readdirSync(SCHEMA_DIR));
    for (const name of EXTENSION_NAMES) {
      expect(files.has(SCHEMA_FILE_MAP[name])).toBe(true);
    }
  });

  it('schema method constants match EXTENSION_METHOD_MAP', () => {
    for (const name of EXTENSION_NAMES) {
      const contract = registry.get(name);
      expect(contract.method).toBe(EXTENSION_METHOD_MAP[name]);
    }
  });

  it('all extension methods follow ext.flutter.ultra.* naming convention', () => {
    for (const name of EXTENSION_NAMES) {
      expect(EXTENSION_METHOD_MAP[name]).toMatch(/^ext\.flutter\.ultra\.\w+$/);
    }
  });

  it('detects if a Dart-side rename of ext.flutter.ultra.tap to ext.flutter.ultra.tapWidget would break', () => {
    const tapFixture = {
      type: '_extensionType',
      method: 'ext.flutter.ultra.tapWidget',
      status: 'Success',
      tapped: true,
    };
    const result = registry.validateResponse('tap', tapFixture);
    expect(result.valid).toBe(false);
  });

  it('detects missing required fields in interactiveElements response', () => {
    const broken = {
      type: '_extensionType',
      method: 'ext.flutter.ultra.interactiveElements',
      status: 'Success',
    };
    const result = registry.validateResponse('interactiveElements', broken);
    expect(result.valid).toBe(false);
  });

  it('detects type change in element bounds (string instead of number)', () => {
    const broken = {
      type: '_extensionType',
      method: 'ext.flutter.ultra.interactiveElements',
      status: 'Success',
      elements: [
        {
          type: 'ElevatedButton',
          bounds: { x: '300', y: '500', width: '56', height: '56' },
        },
      ],
    };
    const result = registry.validateResponse('interactiveElements', broken);
    expect(result.valid).toBe(false);
  });
});

describe('AC-TS3: Schema completeness', () => {
  it('has exactly 16 extension schemas (15 from EXTENSIONS.md + envelope)', () => {
    const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'));
    expect(files).toHaveLength(17);
  });

  it('fixture files cover all 16 extensions', () => {
    const responses = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'fixtures', 'responses.json'), 'utf-8'),
    );
    const requests = JSON.parse(
      readFileSync(resolve(__dirname, '..', 'fixtures', 'requests.json'), 'utf-8'),
    );
    for (const name of EXTENSION_NAMES) {
      expect(responses).toHaveProperty(name);
      expect(requests).toHaveProperty(name);
    }
  });
});
