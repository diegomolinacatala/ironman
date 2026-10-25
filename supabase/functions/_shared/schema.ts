/**
 * Tiny schema library: one definition gives both a runtime validator with
 * Spanish, path-aware error messages and the JSON Schema we publish (MCP tool
 * `inputSchema`, Claude structured-output `format`). Pure, dependency-free.
 */

export type JsonSchema = { [key: string]: unknown };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Schema<T> {
  readonly json: JsonSchema;
  parse(input: unknown, path?: string): Result<T>;
}

export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly isOptional: true;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends OptionalSchema<unknown> ? K : never;
}[keyof S];
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>;
export type ObjectOut<S extends Shape> = { [K in RequiredKeys<S>]: Infer<S[K]> } & {
  [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>;
};

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(path: string, message: string): Result<T> => ({
  ok: false,
  error: `${path || 'valor'}: ${message}`,
});

function withDescription(json: JsonSchema, description?: string): JsonSchema {
  return description ? { ...json, description } : json;
}

export interface StringOptions {
  min?: number;
  max?: number;
  pattern?: RegExp;
  /** Human hint for pattern errors, e.g. "YYYY-MM-DD". */
  hint?: string;
  format?: 'date' | 'date-time' | 'uuid';
  description?: string;
  /** Trim before validating (default true). */
  trim?: boolean;
}

export function string(opts: StringOptions = {}): Schema<string> {
  const json = withDescription(
    {
      type: 'string',
      ...(opts.min !== undefined ? { minLength: opts.min } : {}),
      ...(opts.max !== undefined ? { maxLength: opts.max } : {}),
      ...(opts.pattern ? { pattern: opts.pattern.source } : {}),
      ...(opts.format ? { format: opts.format } : {}),
    },
    opts.description,
  );
  return {
    json,
    parse(input, path = '') {
      if (typeof input !== 'string') return fail(path, 'debe ser un texto');
      const value = opts.trim === false ? input : input.trim();
      if (opts.min !== undefined && value.length < opts.min) {
        return fail(path, opts.min === 1 ? 'no puede estar vacío' : `mínimo ${opts.min} caracteres`);
      }
      if (opts.max !== undefined && value.length > opts.max) return fail(path, `máximo ${opts.max} caracteres`);
      if (opts.pattern && !opts.pattern.test(value)) {
        return fail(path, `formato inválido${opts.hint ? ` (usa ${opts.hint})` : ''}`);
      }
      return ok(value);
    },
  };
}

export interface NumberOptions {
  min?: number;
  max?: number;
  description?: string;
}

function numeric(kind: 'integer' | 'number', opts: NumberOptions): Schema<number> {
  const json = withDescription(
    {
      type: kind,
      ...(opts.min !== undefined ? { minimum: opts.min } : {}),
      ...(opts.max !== undefined ? { maximum: opts.max } : {}),
    },
    opts.description,
  );
  return {
    json,
    parse(input, path = '') {
      if (typeof input !== 'number' || !Number.isFinite(input)) return fail(path, 'debe ser un número');
      if (kind === 'integer' && !Number.isInteger(input)) return fail(path, 'debe ser un número entero');
      if (opts.min !== undefined && input < opts.min) return fail(path, `mínimo ${opts.min}`);
      if (opts.max !== undefined && input > opts.max) return fail(path, `máximo ${opts.max}`);
      return ok(input);
    },
  };
}

export const integer = (opts: NumberOptions = {}): Schema<number> => numeric('integer', opts);
export const number = (opts: NumberOptions = {}): Schema<number> => numeric('number', opts);

export function boolean(description?: string): Schema<boolean> {
  return {
    json: withDescription({ type: 'boolean' }, description),
    parse(input, path = '') {
      return typeof input === 'boolean' ? ok(input) : fail(path, 'debe ser true o false');
    },
  };
}

export function literal<const T extends string>(value: T, description?: string): Schema<T> {
  return {
    json: withDescription({ type: 'string', const: value }, description),
    parse(input, path = '') {
      return input === value ? ok(value) : fail(path, `debe ser "${value}"`);
    },
  };
}

export function enumOf<const T extends string>(values: readonly T[], description?: string): Schema<T> {
  return {
    json: withDescription({ type: 'string', enum: [...values] }, description),
    parse(input, path = '') {
      return typeof input === 'string' && (values as readonly string[]).includes(input)
        ? ok(input as T)
        : fail(path, `valor no válido; usa uno de: ${values.join(', ')}`);
    },
  };
}

export function intEnum<const T extends number>(values: readonly T[], description?: string): Schema<T> {
  return {
    json: withDescription({ type: 'integer', enum: [...values] }, description),
    parse(input, path = '') {
      return typeof input === 'number' && (values as readonly number[]).includes(input)
        ? ok(input as T)
        : fail(path, `valor no válido; usa uno de: ${values.join(', ')}`);
    },
  };
}

export interface ArrayOptions {
  min?: number;
  max?: number;
  description?: string;
}

export function array<T>(item: Schema<T>, opts: ArrayOptions = {}): Schema<T[]> {
  const json = withDescription(
    {
      type: 'array',
      items: item.json,
      ...(opts.min !== undefined ? { minItems: opts.min } : {}),
      ...(opts.max !== undefined ? { maxItems: opts.max } : {}),
    },
    opts.description,
  );
  return {
    json,
    parse(input, path = '') {
      if (!Array.isArray(input)) return fail(path, 'debe ser una lista');
      if (opts.min !== undefined && input.length < opts.min) return fail(path, `mínimo ${opts.min} elementos`);
      if (opts.max !== undefined && input.length > opts.max) return fail(path, `máximo ${opts.max} elementos`);
      const out: T[] = [];
      for (let i = 0; i < input.length; i += 1) {
        const r = item.parse(input[i], `${path}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return ok(out);
    },
  };
}

export function optional<T>(schema: Schema<T>): OptionalSchema<T> {
  return {
    json: schema.json,
    isOptional: true,
    parse(input, path = '') {
      return input === undefined ? ok(undefined) : schema.parse(input, path);
    },
  };
}

export function nullable<T>(schema: Schema<T>): Schema<T | null> {
  const { description, ...rest } = schema.json;
  return {
    json: withDescription({ anyOf: [rest, { type: 'null' }] }, typeof description === 'string' ? description : undefined),
    parse(input, path = '') {
      return input === null ? ok(null) : schema.parse(input, path);
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ObjectOptions {
  /** Drop unknown keys instead of rejecting them (app-facing APIs). JSON Schema stays strict. */
  stripUnknown?: boolean;
}

export function object<S extends Shape>(shape: S, description?: string, options: ObjectOptions = {}): Schema<ObjectOut<S>> {
  const keys = Object.keys(shape);
  const required = keys.filter((k) => !('isOptional' in shape[k]));
  const properties = Object.fromEntries(keys.map((k) => [k, shape[k].json]));
  const json = withDescription(
    { type: 'object', properties, required, additionalProperties: false },
    description,
  );
  return {
    json,
    parse(input, path = '') {
      if (!isPlainObject(input)) return fail(path, 'debe ser un objeto');
      const unknownKey = Object.keys(input).find((k) => !Object.prototype.hasOwnProperty.call(shape, k));
      if (unknownKey && !options.stripUnknown) {
        return fail(path ? `${path}.${unknownKey}` : unknownKey, 'campo no permitido');
      }
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        const childPath = path ? `${path}.${key}` : key;
        if (input[key] === undefined && required.includes(key)) return fail(childPath, 'es obligatorio');
        const r = shape[key].parse(input[key], childPath);
        if (!r.ok) return r;
        if (r.value !== undefined) out[key] = r.value;
      }
      return ok(out as ObjectOut<S>);
    },
  };
}

/** Discriminated union on a string field (e.g. PlanChange.op). */
export function discriminated<T>(
  field: string,
  variants: Record<string, Schema<T>>,
  description?: string,
): Schema<T> {
  const tags = Object.keys(variants);
  return {
    json: withDescription({ anyOf: tags.map((t) => variants[t].json) }, description),
    parse(input, path = '') {
      if (!isPlainObject(input)) return fail(path, 'debe ser un objeto');
      const tag = input[field];
      if (typeof tag !== 'string' || !Object.prototype.hasOwnProperty.call(variants, tag)) {
        return fail(path ? `${path}.${field}` : field, `usa uno de: ${tags.join(', ')}`);
      }
      return variants[tag].parse(input, path);
    },
  };
}

const UNSUPPORTED_IN_STRUCTURED_OUTPUT = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'default',
]);

/**
 * Strips keywords that Claude structured outputs do not accept (numeric and
 * string constraints, array bounds). The runtime validator still enforces them.
 */
export function toStructuredOutputSchema(json: unknown): unknown {
  if (Array.isArray(json)) return json.map(toStructuredOutputSchema);
  if (!isPlainObject(json)) return json;
  return Object.fromEntries(
    Object.entries(json)
      .filter(([key]) => !UNSUPPORTED_IN_STRUCTURED_OUTPUT.has(key))
      .map(([key, value]) => {
        if (key === 'enum' || key === 'const') return [key, value];
        if (key === 'properties' && isPlainObject(value)) {
          // Property names are data, not keywords: never filter them.
          return [key, Object.fromEntries(Object.entries(value).map(([p, s]) => [p, toStructuredOutputSchema(s)]))];
        }
        return [key, toStructuredOutputSchema(value)];
      }),
  );
}
