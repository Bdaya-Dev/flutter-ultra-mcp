import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
 
const Ajv2020 = require('ajv/dist/2020') as { new (opts: Record<string, unknown>): AjvInstance };
 
const addFormats = require('ajv-formats') as (ajv: AjvInstance) => void;

interface AjvInstance {
  addSchema(schema: Record<string, unknown>, key: string): void;
  compile(schema: Record<string, unknown>): ValidateFunction;
}
interface ValidateFunction {
  (data: unknown): boolean;
  errors?: Array<{ instancePath?: string; message?: string }>;
}
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_NAMES, SCHEMA_FILE_MAP, type ExtensionName } from './extensions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, '..', 'ext-flutter-ultra');

export interface ExtensionContract {
  name: ExtensionName;
  method: string;
  responseValidator: ValidateFunction;
  requestSchema: Record<string, unknown> | undefined;
  rawSchema: Record<string, unknown>;
}

export class ContractRegistry {
  private readonly ajv: AjvInstance;
  private readonly contracts = new Map<ExtensionName, ExtensionContract>();

  constructor() {
    this.ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(this.ajv);
    this.loadEnvelope();
    for (const name of EXTENSION_NAMES) {
      this.loadExtension(name);
    }
  }

  private loadEnvelope(): void {
    const raw = JSON.parse(readFileSync(resolve(SCHEMA_DIR, 'envelope.schema.json'), 'utf-8'));
    this.ajv.addSchema(raw, 'envelope.schema.json');
  }

  private loadExtension(name: ExtensionName): void {
    const filename = SCHEMA_FILE_MAP[name];
    const raw = JSON.parse(readFileSync(resolve(SCHEMA_DIR, filename), 'utf-8'));
    const validator = this.ajv.compile(raw);
    const method = raw.properties?.method?.const as string;
    const requestSchema = raw.request as Record<string, unknown> | undefined;

    this.contracts.set(name, {
      name,
      method,
      responseValidator: validator,
      requestSchema,
      rawSchema: raw,
    });
  }

  get(name: ExtensionName): ExtensionContract {
    const c = this.contracts.get(name);
    if (!c) throw new Error(`Unknown extension: ${name}`);
    return c;
  }

  all(): ExtensionContract[] {
    return [...this.contracts.values()];
  }

  validateResponse(name: ExtensionName, data: unknown): { valid: boolean; errors: string[] } {
    const contract = this.get(name);
    const valid = contract.responseValidator(data);
    const errors = valid
      ? []
      : (contract.responseValidator.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
    return { valid: valid as boolean, errors };
  }

  validateRequest(name: ExtensionName, data: unknown): { valid: boolean; errors: string[] } {
    const contract = this.get(name);
    if (!contract.requestSchema) {
      return { valid: true, errors: [] };
    }
    const validator = this.ajv.compile(contract.requestSchema);
    const valid = validator(data);
    const errors = valid
      ? []
      : (validator.errors ?? []).map(
          (e: { instancePath?: string; message?: string }) => `${e.instancePath} ${e.message}`,
        );
    return { valid: valid as boolean, errors };
  }

  extensionNames(): readonly ExtensionName[] {
    return EXTENSION_NAMES;
  }
}
