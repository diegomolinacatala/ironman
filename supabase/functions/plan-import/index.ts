/**
 * External training plan reader: POST { kind: 'text', text } | { kind: 'image', imageBase64 } |
 * { kind: 'pdf', pdfBase64 } with the user JWT → 200 PlanImportResponse (the app reviews it and saves
 * it with the apply_plan_import RPC). verify_jwt = false in config.toml; the JWT is verified in code
 * (userIdFromJwt), like `meal`. Free AI only: Workers AI text model (Qwen) for text and PDF text, vision
 * model (Llama 4 Scout) for photos. PDF text comes from unpdf (serverless PDF.js build, MIT); only the
 * first 30 pages are read and no images are decoded. Stores nothing but the ai_usage row.
 */
import { extractText, getDocumentProxy } from 'npm:unpdf@2.1.0';

import { bearerToken } from '../_shared/http.ts';
import { handlePlanImportHttp } from '../_shared/plan-import/http.ts';
import type { PdfTextPort } from '../_shared/plan-import/http.ts';
import { createAiPort } from '../_shared/platform/ai-provider.ts';
import { userIdFromJwt } from '../_shared/platform/db.ts';
import { edgeContext, misconfigured } from '../_shared/platform/runtime.ts';
import { createAiUsageStore } from '../_shared/platform/service-stores.ts';

const env = (name: string): string | undefined => Deno.env.get(name);
const { db, logger } = edgeContext('plan-import', env);
const text = createAiPort(env, 'text', logger);
const vision = createAiPort(env, 'vision', logger);
const usage = db ? createAiUsageStore(db) : null;

const pdfText: PdfTextPort = async (bytes, maxPages) => {
  // Small images only: a hostile PDF cannot make PDF.js allocate gigabytes.
  const pdf = await getDocumentProxy(bytes, { maxImageSize: 1_000_000 });
  // extractText reads every page: refuse documents far beyond a training plan (checked with unpdf 2.1.0).
  if (pdf.numPages > maxPages * 4) throw new Error('too many pages');
  const pages = Math.min(pdf.numPages, maxPages);
  const { text: all } = await extractText(pdf, { mergePages: false });
  return { pages, text: all.slice(0, pages).join('\n\n') };
};

Deno.serve((req: Request) => {
  if (!db || !usage) return misconfigured();
  return handlePlanImportHttp(req, {
    authenticate: (r) => userIdFromJwt(db, bearerToken(r)),
    usage,
    text,
    vision,
    pdfText,
    logger,
  });
});
