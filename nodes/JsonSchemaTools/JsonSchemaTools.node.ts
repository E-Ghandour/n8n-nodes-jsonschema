import {
  GenericValue,
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';

type Operation = 'validate' | 'textToJson' | 'normalize';
type JsonValue = GenericValue | IDataObject | GenericValue[] | IDataObject[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class JsonSchemaTools implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'JSON Schema Tools',
    name: 'jsonSchemaTools',
    icon: { light: 'file:json.light.svg', dark: 'file:json.dark.svg' },
    group: ['transform'],
    version: 1,
    description: 'Validate and normalize JSON/text to a target schema',
    subtitle: 'Validate and normalize JSON/text to a target schema',
    defaults: { name: 'JSON Schema Tools' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Schema Validator',
            value: 'validate',
            description: 'Validate input against schema',
            action: 'Validate input against schema',
          },
          {
            name: 'Text to JSON',
            value: 'textToJson',
            description: 'Parse text that looks like JSON',
            action: 'Parse text that looks like JSON',
          },
          {
            name: 'Unstructured to Structured',
            value: 'normalize',
            description: 'Map input to schema structure',
            action: 'Map input to schema structure',
          },
        ],
        default: 'validate',
      },
      {
        displayName: 'Input',
        name: 'input',
        type: 'string',
        default: '',
        description: 'Input text or JSON string',
        required: true,
      },
      {
        displayName: 'Schema (JSON)',
        name: 'schema',
        type: 'json',
        default: {},
        description: 'JSON Schema to validate or map to',
        displayOptions: {
          show: {
            operation: ['validate', 'normalize']
          }
        }
      },
      {
        displayName: 'Auto Map (Normalize)',
        name: 'autoMap',
        type: 'boolean',
        default: true,
        displayOptions: { show: { operation: ['normalize'] } },
        description: 'Whether to try to auto-map fields by name similarity and case-insensitive match or not',
      },
      {
        displayName: 'Strict Validation (Validate)',
        name: 'strict',
        type: 'boolean',
        default: true,
        displayOptions: { show: { operation: ['validate'] } },
        description: 'Whether to let the validation fail on additional properties when schema forbids them or not',
      },
    ],
    usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const operation = this.getNodeParameter('operation', 0, 'validate') as Operation;

    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        let schema: IDataObject = {};
        try {
          const rawSchema = this.getNodeParameter('schema', i, {}) as unknown;

          if (typeof rawSchema === 'string') {
            const s = rawSchema.trim();
            if (s === '') {
              schema = {};
            } else {
              try {
                schema = JSON.parse(s) as IDataObject;
              } catch {
                schema = {};
              }
            }
          } else if (isRecord(rawSchema)) {
            schema = rawSchema as IDataObject;
          } else {
            schema = {};
          }
        } catch {
          schema = {};
        }

        const pairedItem = { item: i };

        let inputParam = '';
        try {
          inputParam = this.getNodeParameter('input', i, '') as string;
        } catch {
          inputParam = '';
        }

        if (typeof inputParam !== 'string' || inputParam.trim() === '') {
          throw new NodeOperationError(this.getNode(), 'Input is required and must be a non-empty string', {
            itemIndex: i,
          });
        }

        let inputData: unknown = items[i].json ?? {};
        try {
          inputData = tryParseTextToJson(inputParam, this, i);
        } catch {
          // ignore parse errors, keep rawValue
          inputData = inputParam;
        }

        if (operation === 'textToJson') {

          if (typeof inputData === 'string' && inputData.trim() === '') {
            results.push({ json: { success: false, parsed: null }, pairedItem });
            continue;
          }

          const parsed = tryParseTextToJson(
            typeof inputData === 'string' ? inputData : JSON.stringify(inputData),
            this,
            i
          );

          results.push({ json: { success: true, parsed: toJsonValue(parsed) }, pairedItem });
          continue;
        }

        if (operation === 'validate') {
          const strict = this.getNodeParameter('strict', i, true) as boolean;
          const validation = validateSchema(schema, inputData, strict);
          results.push({ json: { valid: validation.ok, errors: validation.errors ?? null }, pairedItem });
          continue;
        }

        if (operation === 'normalize') {
          const autoMap = this.getNodeParameter('autoMap', i, true) as boolean;
          const normalized = normalizeToSchema(inputData, schema, autoMap, this, i);
          results.push({ json: { normalized: toJsonValue(normalized) }, pairedItem });
          continue;
        }

        results.push({ json: { error: 'Unknown operation' }, pairedItem });
      } catch (error) {
        if (this.continueOnFail()) {
          const pairedItem = { item: i };
          const message = error instanceof Error ? error.message : String(error);
          results.push({ json: { error: message }, pairedItem });
        } else {
          throw new NodeOperationError(this.getNode(), error instanceof Error ? error.message : String(error), {
            itemIndex: i,
          });
        }
      }
    }

    return [results];
  }
}

function tryParseTextToJson(
  text: string | null | undefined,
  context: IExecuteFunctions,
  itemIndex?: number,
): unknown {

  if (text === null || text === undefined) {
    throw new NodeOperationError(context.getNode(), 'No input to parse', itemIndex === undefined ? undefined : { itemIndex });
  }

  const trimmed = text.trim();

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // ignore parse errors, keep rawValue
    }
  }

  const singleQuoteAttempt = trimmed
    .replace(/(['"])?([a-zA-Z0-9_]+)(['"]?)?:/g, '"$2":')
    .replace(/'/g, '"');

  try {
    return JSON.parse(singleQuoteAttempt);
  } catch {
    // ignore parse errors, keep rawValue
    }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();

    if (inner.includes(',')) {
      const obj: Record<string, unknown> = {};
      const parts = inner.split(',').map(p => p.trim()).filter(Boolean);

      for (const part of parts) {
        const kv = part.split(':');

        if (kv.length !== 2) {
          throw new NodeOperationError(
            context.getNode(),
            `Invalid key:value format inside object: "${part}"`,
            itemIndex === undefined ? undefined : { itemIndex }
          );
        }

        const key = kv[0].trim().replace(/^"|"$/g, '');
        const rawValue = kv[1].trim();
        let parsedValue: unknown = rawValue;

        if (rawValue === '') {
          obj[key] = null;
          continue;
        }

        try {
          parsedValue = JSON.parse(rawValue);
        } catch {
          // ignore parse errors, keep rawValue
        }

        obj[key] = parsedValue;
      }

      return obj;
    }
  }

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  if (lines.length > 0) {
    const obj: Record<string, unknown> = {};

    for (const line of lines) {
      const parts = line.split(':');

      if (parts.length !== 2) {
        throw new NodeOperationError(context.getNode(), `Invalid key:value format: "${line}"`, itemIndex === undefined ? undefined : { itemIndex });
      }

      const key = parts[0].trim().replace(/^"|"$/g, '');
      let value = parts[1].trim();

      try {
        value = JSON.parse(value);
      } catch {
        // ignore parse errors, keep rawValue
      }

      obj[key] = value;
    }

    return obj;
  }

  throw new NodeOperationError(context.getNode(), 'Unable to parse input as JSON', itemIndex === undefined ? undefined : { itemIndex });
}


function validateSchema(
  schema: IDataObject,
  data: unknown,
  strict = true,
): { ok: boolean; errors?: Array<{ keyword: string; message: string }> } {
  if (!schema || Object.keys(schema).length === 0) {
    return { ok: true };
  }

  const errors: Array<{ keyword: string; message: string }> = [];

  if (schema.type) {
    const expected = String(schema.type);
    const actual = Array.isArray(data) ? 'array' : typeof data;
    if (actual !== expected) {
      errors.push({ keyword: 'type', message: `Expected type ${expected} but got ${actual}` });
    }
  }

  if (schema.required && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (isRecord(data) && data[key] === undefined) {
        errors.push({ keyword: 'required', message: `Missing required property: ${key}` });
      }
    }
  }

  if (isRecord(schema.properties) && isRecord(data)) {
    for (const [key, propValue] of Object.entries(schema.properties)) {
      const propSchema = isRecord(propValue) ? propValue : undefined;
      const value = data[key];

      if (value !== undefined && propSchema?.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== String(propSchema.type)) {
          errors.push({
            keyword: 'type',
            message: `Property ${key} expected type ${String(propSchema.type)} but got ${actualType}`,
          });
        }
      }
    }
  }

  if (strict && schema.additionalProperties === false && isRecord(data)) {
    const allowed = new Set(Object.keys(isRecord(schema.properties) ? schema.properties : {}));
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) {
        errors.push({
          keyword: 'additionalProperties',
          message: `Additional property ${key} not allowed`,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function normalizeToSchema(
  data: unknown,
  schema: IDataObject,
  autoMap = true,
  context: IExecuteFunctions,
  itemIndex?: number,
): unknown {
  if (!schema || !schema.properties) {
    return data;
  }

  if (typeof data === 'string') {
    try {
      data = tryParseTextToJson(data, context, itemIndex);
    } catch (error) {
      void error;
    }
  }

  const out: Record<string, unknown> = {};
  const srcKeys = isRecord(data) ? Object.keys(data) : [];

  if (isRecord(schema.properties)) {
    for (const targetKey of Object.keys(schema.properties)) {
      if (isRecord(data) && Object.prototype.hasOwnProperty.call(data, targetKey)) {
        out[targetKey] = data[targetKey];
        continue;
      }

      const ci = srcKeys.find((key) => key.toLowerCase() === targetKey.toLowerCase());
      if (ci) {
        out[targetKey] = isRecord(data) ? data[ci] : undefined;
        continue;
      }

      if (autoMap) {
        const normalizedTarget = normalizeKey(targetKey);
        const found = srcKeys.find((key) => normalizeKey(key) === normalizedTarget);
        if (found) {
          out[targetKey] = isRecord(data) ? data[found] : undefined;
          continue;
        }
      }

      const prop = isRecord(schema.properties[targetKey]) ? schema.properties[targetKey] : undefined;
      if (prop && isRecord(prop) && prop.default !== undefined) {
        out[targetKey] = prop.default;
        continue;
      }

      out[targetKey] = null;
    }
  }

  if (schema.type === 'array' && schema.items && !Array.isArray(out)) {
    return [out];
  }

  if (deepEqual(out, data)) return data;

  return out;
}

function normalizeKey(key: string) {
  return key.replace(/[_\s-]+/g, '').toLowerCase();
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value as GenericValue;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item)) as GenericValue[];
  }

  if (isRecord(value)) {
    const result: IDataObject = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = toJsonValue(nestedValue) as IDataObject | GenericValue | GenericValue[] | IDataObject[];
    }
    return result;
  }

  return String(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!deepEqual(aRecord[key], bRecord[key])) return false;
  }

  return true;
}
