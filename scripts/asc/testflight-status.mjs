import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from './client.mjs';

const api = createClient();
const { APP_BUNDLE_ID: bundle, IOS_BUILD_NUMBER: number } = process.env;
if (!bundle || !/^\d+$/.test(number ?? '')) throw new Error('Indica el bundle y el número de compilación.');

const { data: apps } = await api.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundle)}`);
if (!apps[0]) throw new Error('Apple no encuentra esta app.');
const query = new URLSearchParams({ 'filter[app]': apps[0].id, 'filter[version]': number, include: 'buildBetaDetail' });
const deadline = Date.now() + 30 * 60_000;
let ready = false;
while (Date.now() < deadline) {
  const { data, included } = await api.get(`/v1/builds?${query}`);
  const build = data[0];
  const detail = included?.find((item) => item.type === 'buildBetaDetails' && item.id === build?.relationships?.buildBetaDetail?.data?.id);
  const processing = build?.attributes.processingState;
  const internal = detail?.attributes.internalBuildState;
  console.log(`Build ${number} · ${processing ?? 'pendiente de recepción'} · pruebas internas ${internal ?? 'pendientes'}`);
  if (processing === 'FAILED' || processing === 'INVALID' || build?.attributes.expired) throw new Error('Apple ha rechazado o caducado la compilación.');
  if (processing === 'VALID' && internal && !internal.startsWith('PROCESSING')) {
    console.log(`https://appstoreconnect.apple.com/apps/${apps[0].id}/testflight/ios/${build.id}`);
    ready = true;
    break;
  }
  await delay(30_000);
}
if (!ready) throw new Error('Apple todavía no ha confirmado el estado interno. Vuelve a consultar esta build.');
