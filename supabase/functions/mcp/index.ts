/**
 * Personal MCP connector for the user's own Claude ("Conecta tu Claude").
 * URL: https://<ref>.supabase.co/functions/v1/mcp/u/<secret>   (verify_jwt = false)
 */
import { handleMcpHttp } from '../_shared/mcp/endpoint.ts';
import { createRateLimiter } from '../_shared/mcp/token-gate.ts';
import { MCP_INSTRUCTIONS } from '../_shared/mcp/instructions.ts';
import { createToolRegistry } from '../_shared/mcp/tools/index.ts';
import { resolveToken } from '../_shared/platform/db.ts';
import { createPlanningStore } from '../_shared/platform/planning-store.ts';
import { edgeContext, misconfigured, systemNow } from '../_shared/platform/runtime.ts';

const { db, logger } = edgeContext('mcp', (name) => Deno.env.get(name));
const tools = createToolRegistry();
const rateLimiter = createRateLimiter({ limit: 120, windowMs: 60_000, globalLimit: 1200 });
const store = db ? createPlanningStore(db, systemNow) : null;

Deno.serve((req: Request) => {
  if (!db || !store) return misconfigured();
  return handleMcpHttp(req, {
    resolveUserId: (hash) => resolveToken(db, hash, 'mcp'),
    toolContext: (userId) => ({ userId, store, now: systemNow, logger }),
    tools,
    instructions: MCP_INSTRUCTIONS,
    rateLimiter,
    logger,
    now: systemNow,
  });
});
