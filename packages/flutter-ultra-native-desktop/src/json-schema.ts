// Minimal Zod-to-JSON-Schema converter — mirrors the gesture server's
// implementation. We deliberately avoid pulling in `zod-to-json-schema`
// (extra dep, ~80 KB) because the LLM only needs to see the shape; runtime
// validation still goes through Zod in the request handler.

import type { ZodTypeAny } from 'zod';

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  default?: unknown;
  description?: string;
  additionalProperties?: boolean | JsonSchema;
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return convert(schema, new WeakSet());
}

function convert(schema: ZodTypeAny, lazyBodies: WeakSet<object>): JsonSchema {
  const def = (schema as { _def: { typeName: string } })._def;
  switch (def.typeName) {
    case 'ZodObject':
      return convertObject(schema, lazyBodies);
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return {
        type: 'array',
        items: convert((schema as unknown as { element: ZodTypeAny }).element, lazyBodies),
      };
    case 'ZodEnum':
      return {
        type: 'string',
        enum: (schema as unknown as { options: string[] }).options,
      };
    case 'ZodLiteral':
      return {
        type: 'string',
        enum: [(schema as unknown as { value: unknown }).value],
      };
    case 'ZodOptional':
    case 'ZodNullable':
      return convert((schema as unknown as { unwrap(): ZodTypeAny }).unwrap(), lazyBodies);
    case 'ZodDefault':
      return {
        ...convert(
          (schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType,
          lazyBodies,
        ),
        default: (schema as unknown as { _def: { defaultValue(): unknown } })._def.defaultValue(),
      };
    case 'ZodUnion':
      return {
        anyOf: (schema as unknown as { options: ZodTypeAny[] }).options.map((s) =>
          convert(s, lazyBodies),
        ),
      };
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: convert(
          (schema as unknown as { valueSchema: ZodTypeAny }).valueSchema,
          lazyBodies,
        ),
      };
    case 'ZodLazy': {
      if (lazyBodies.has(schema as unknown as object)) return {};
      lazyBodies.add(schema as unknown as object);
      const body = (schema as unknown as { _def: { getter(): ZodTypeAny } })._def.getter();
      return convert(body, lazyBodies);
    }
    case 'ZodUnknown':
    case 'ZodAny':
      return {};
    default:
      return {};
  }
}

function convertObject(schema: ZodTypeAny, lazyBodies: WeakSet<object>): JsonSchema {
  const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = convert(value, lazyBodies);
    if (!isOptional(value)) required.push(key);
  }
  const out: JsonSchema = { type: 'object', properties };
  if (required.length > 0) out.required = required;
  return out;
}

function isOptional(schema: ZodTypeAny): boolean {
  const typeName = (schema as { _def: { typeName: string } })._def.typeName;
  return typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodNullable';
}
