/**
 * MCP tool plumbing: definition shape, result builders and the registry that
 * validates arguments before calling a handler.
 */
import type { Logger } from '../log.ts';
import { errorInfo } from '../log.ts';
import { NotFoundError } from '../planning/context.ts';
import type { PlanningStore } from '../planning/store.ts';
import type { JsonSchema, Schema } from '../schema.ts';
import type { UUID } from '../types.ts';

export interface ToolContext {
  userId: UUID;
  store: PlanningStore;
  now: () => Date;
  logger: Logger;
}

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDefinition<A> {
  name: string;
  title: string;
  description: string;
  input: Schema<A>;
  annotations: ToolAnnotations;
  handler: (args: A, ctx: ToolContext) => Promise<ToolResult>;
}

/** Type-erased tool as stored in the registry. */
export interface RegisteredTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
  run: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

/** Thrown by handlers for errors Claude can fix (bad id, date out of range…). */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export function toolOk(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function defineTool<A>(def: ToolDefinition<A>): RegisteredTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.input.json,
    annotations: def.annotations,
    run: async (args, ctx) => {
      const parsed = def.input.parse(args ?? {}, '');
      if (!parsed.ok) {
        return toolError(`Argumentos no válidos para ${def.name}: ${parsed.error}. Revisa el esquema de la herramienta y vuelve a llamarla.`);
      }
      try {
        return await def.handler(parsed.value, ctx);
      } catch (error) {
        if (error instanceof ToolInputError || error instanceof NotFoundError) return toolError(error.message);
        ctx.logger.error('mcp tool failed', { tool: def.name, ...errorInfo(error) });
        return toolError(`No se pudo completar ${def.name} por un error interno. Inténtalo de nuevo en unos segundos; si persiste, avisa al usuario.`);
      }
    },
  };
}

export interface ToolRegistry {
  list(): RegisteredTool[];
  get(name: string): RegisteredTool | undefined;
}

export function createRegistry(tools: readonly RegisteredTool[]): ToolRegistry {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    list: () => [...tools],
    get: (name) => byName.get(name),
  };
}

/** Wire format for tools/list (deterministic order = registration order). */
export function toolListEntry(tool: RegisteredTool): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

export const READ_ONLY: Omit<ToolAnnotations, 'title'> = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
