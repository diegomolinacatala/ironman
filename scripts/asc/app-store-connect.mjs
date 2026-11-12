#!/usr/bin/env node
/**
 * Fills the App Store listing from store/listing.json through the App Store Connect API and,
 * with --submit, sends the version to App Review. Runs from .github/workflows/app-store.yml.
 *
 * What Apple does NOT expose in the API (done by hand, see docs/APP_STORE.md): App Privacy
 * labels and the EU trader (DSA) declaration.
 *
 * Env: ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID; ASC_REVIEW_CODE (review account code, from
 * scripts/review-account.mjs); ASC_CONTACT_PHONE (review contact, e.g. +34 600 000 000).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient, fileInfo, rel, runUploadOperations } from './client.mjs';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const listing = JSON.parse(readFileSync(join(ROOT, 'store/listing.json'), 'utf8'));
const SCREENSHOTS_DIR = join(ROOT, 'store/screenshots');
const EDITABLE = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY']);

const api = createClient();
const submit = process.argv.includes('--submit');
const problems = [];

async function step(name, fn) {
  try {
    const note = await fn();
    console.log(`✓ ${name}${note ? `: ${note}` : ''}`);
  } catch (error) {
    problems.push(`${name}: ${error.message}`);
    console.log(`✗ ${name}: ${error.message}`);
  }
}

const stateOf = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState ?? v.attributes.state;

async function findApp() {
  const res = await api.get(`/v1/apps?filter[bundleId]=${encodeURIComponent(listing.bundleId)}`);
  const app = res.data[0];
  if (!app) throw new Error(`No hay ninguna app con el bundle ${listing.bundleId} en App Store Connect.`);
  return app;
}

async function editableAppInfo(appId) {
  const res = await api.get(`/v1/apps/${appId}/appInfos`);
  const live = new Set(['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'REPLACED_WITH_NEW_INFO']);
  return res.data.find((i) => !live.has(i.attributes.state ?? i.attributes.appStoreState)) ?? res.data[0];
}

async function upsertLocalization({ listPath, type, patchPath, parentRel, attributes }) {
  const res = await api.get(listPath);
  const current = res.data.find((l) => l.attributes.locale === listing.locale);
  if (current) {
    await api.patch(`${patchPath}/${current.id}`, { data: { type, id: current.id, attributes } });
    return current.id;
  }
  const created = await api.post(patchPath, {
    data: { type, attributes: { locale: listing.locale, ...attributes }, relationships: parentRel },
  });
  return created.data.id;
}

async function ensureVersion(appId) {
  const res = await api.get(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=20`);
  const editable = res.data.find((v) => EDITABLE.has(stateOf(v)));
  if (editable) {
    if (editable.attributes.versionString !== listing.version) {
      await api.patch(`/v1/appStoreVersions/${editable.id}`, {
        data: { type: 'appStoreVersions', id: editable.id, attributes: { versionString: listing.version } },
      });
    }
    return editable;
  }
  const created = await api.post('/v1/appStoreVersions', {
    data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: listing.version }, relationships: { app: rel('apps', appId) } },
  });
  return created.data;
}

async function setAgeRating(appInfoId) {
  const res = await api.get(`/v1/appInfos/${appInfoId}/ageRatingDeclaration`);
  const decl = res.data;
  // Everything "none/false" unless listing.ageRating says otherwise; unknown future keys are left alone.
  const attributes = {};
  for (const [key, value] of Object.entries(decl.attributes)) {
    if (typeof value === 'boolean' || value === null) attributes[key] = false;
    if (typeof value === 'string' && /^(NONE|INFREQUENT_OR_MILD|FREQUENT_OR_INTENSE|INFREQUENT|FREQUENT)$/.test(value)) attributes[key] = 'NONE';
  }
  delete attributes.kidsAgeBand;
  delete attributes.ageRatingOverride;
  for (const [key, value] of Object.entries(listing.ageRating)) {
    if (key in decl.attributes) attributes[key] = value;
  }
  await api.patch(`/v1/ageRatingDeclarations/${decl.id}`, { data: { type: 'ageRatingDeclarations', id: decl.id, attributes } });
}

async function setFreePrice(appId) {
  const existing = await api.maybe(`/v1/apps/${appId}/appPriceSchedule`);
  if (existing?.data) return 'ya tenía precio';
  const points = await api.get(`/v1/apps/${appId}/appPricePoints?filter[territory]=USA&limit=200`);
  const free = points.data.find((p) => Number(p.attributes.customerPrice) === 0);
  if (!free) throw new Error('No encuentro el precio gratuito.');
  await api.post('/v1/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: {
        app: rel('apps', appId),
        baseTerritory: rel('territories', 'USA'),
        manualPrices: { data: [{ type: 'appPrices', id: '${free}' }] },
      },
    },
    included: [{ type: 'appPrices', id: '${free}', attributes: { startDate: null }, relationships: { appPricePoint: rel('appPricePoints', free.id) } }],
  });
  return 'gratis';
}

async function setAvailability(appId) {
  const existing = await api.maybe(`/v1/apps/${appId}/appAvailabilityV2`);
  if (existing?.data) return 'ya estaba configurada';
  const territories = [];
  for (let next = '/v1/territories?limit=200'; next; ) {
    const page = await api.get(next);
    territories.push(...page.data.map((t) => t.id));
    next = page.links?.next ? page.links.next.replace('https://api.appstoreconnect.apple.com', '') : null;
  }
  await api.post('/v2/appAvailabilities', {
    data: {
      type: 'appAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: {
        app: rel('apps', appId),
        territoryAvailabilities: { data: territories.map((t) => ({ type: 'territoryAvailabilities', id: `\${${t}}` })) },
      },
    },
    included: territories.map((t) => ({
      type: 'territoryAvailabilities',
      id: `\${${t}}`,
      attributes: { available: true },
      relationships: { territory: rel('territories', t) },
    })),
  });
  return `${territories.length} países`;
}

async function setReviewDetail(versionId) {
  const code = process.env.ASC_REVIEW_CODE ?? '';
  const phone = process.env.ASC_CONTACT_PHONE ?? '';
  const attributes = {
    ...listing.review,
    demoAccountRequired: true,
    ...(code ? { demoAccountPassword: code } : {}),
    ...(phone ? { contactPhone: phone } : {}),
  };
  const existing = await api.maybe(`/v1/appStoreVersions/${versionId}/appStoreReviewDetail`);
  if (existing?.data) {
    await api.patch(`/v1/appStoreReviewDetails/${existing.data.id}`, { data: { type: 'appStoreReviewDetails', id: existing.data.id, attributes } });
  } else {
    await api.post('/v1/appStoreReviewDetails', {
      data: { type: 'appStoreReviewDetails', attributes, relationships: { appStoreVersion: rel('appStoreVersions', versionId) } },
    });
  }
  const missing = [code ? null : 'ASC_REVIEW_CODE', phone ? null : 'ASC_CONTACT_PHONE'].filter(Boolean);
  if (missing.length) throw new Error(`guardado, pero faltan los secretos ${missing.join(' y ')}`);
}

async function attachBuild(appId, versionId) {
  const query = `filter[app]=${appId}&filter[preReleaseVersion.version]=${listing.version}&filter[processingState]=VALID&filter[expired]=false&sort=-uploadedDate&limit=1`;
  const res = await api.get(`/v1/builds?${query}`);
  const build = res.data[0];
  if (!build) throw new Error(`todavía no hay ninguna build ${listing.version} procesada`);
  await api.patch(`/v1/appStoreVersions/${versionId}/relationships/build`, { data: { type: 'builds', id: build.id } });
  return `build ${build.attributes.version}`;
}

async function uploadScreenshots(localizationId) {
  const files = readdirSync(SCREENSHOTS_DIR).filter((f) => f.endsWith('.png')).sort();
  if (files.length === 0) throw new Error('no hay capturas en store/screenshots');
  const sets = await api.get(`/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`);
  let set = sets.data.find((s) => s.attributes.screenshotDisplayType === listing.screenshotDisplayType);
  if (!set) {
    set = (
      await api.post('/v1/appScreenshotSets', {
        data: {
          type: 'appScreenshotSets',
          attributes: { screenshotDisplayType: listing.screenshotDisplayType },
          relationships: { appStoreVersionLocalization: rel('appStoreVersionLocalizations', localizationId) },
        },
      })
    ).data;
  }
  const old = await api.get(`/v1/appScreenshotSets/${set.id}/appScreenshots`);
  for (const shot of old.data) await api.del(`/v1/appScreenshots/${shot.id}`);
  for (const file of files) {
    const path = join(SCREENSHOTS_DIR, file);
    const reserved = await api.post('/v1/appScreenshots', {
      data: { type: 'appScreenshots', attributes: fileInfo(path), relationships: { appScreenshotSet: rel('appScreenshotSets', set.id) } },
    });
    const checksum = await runUploadOperations(path, reserved.data.attributes.uploadOperations);
    await api.patch(`/v1/appScreenshots/${reserved.data.id}`, {
      data: { type: 'appScreenshots', id: reserved.data.id, attributes: { uploaded: true, sourceFileChecksum: checksum } },
    });
  }
  return `${files.length} capturas`;
}

async function submitForReview(appId, versionId) {
  const open = await api.get(`/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`);
  const submission = open.data[0] ?? (await api.post('/v1/reviewSubmissions', {
    data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: rel('apps', appId) } },
  })).data;
  await api.post('/v1/reviewSubmissionItems', {
    data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: rel('reviewSubmissions', submission.id), appStoreVersion: rel('appStoreVersions', versionId) } },
  }).catch((error) => {
    if (!/already|ENTITY_ERROR\.RELATIONSHIP/i.test(error.message)) throw error;
  });
  await api.patch(`/v1/reviewSubmissions/${submission.id}`, { data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } } });
  return 'enviada a revisión';
}

async function main() {
  const app = await findApp();
  console.log(`App: ${app.attributes.name} (${app.id})`);
  const appInfo = await editableAppInfo(app.id);
  const version = await ensureVersion(app.id);
  console.log(`Versión ${listing.version}: ${stateOf(version)}`);
  let versionLocId = null;

  await step('Derechos de contenido', () =>
    api.patch(`/v1/apps/${app.id}`, { data: { type: 'apps', id: app.id, attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } } }),
  );
  await step('Categorías', () =>
    api.patch(`/v1/appInfos/${appInfo.id}`, {
      data: {
        type: 'appInfos',
        id: appInfo.id,
        relationships: { primaryCategory: rel('appCategories', listing.primaryCategory), secondaryCategory: rel('appCategories', listing.secondaryCategory) },
      },
    }),
  );
  await step('Nombre, subtítulo y privacidad', () =>
    upsertLocalization({
      listPath: `/v1/appInfos/${appInfo.id}/appInfoLocalizations`,
      type: 'appInfoLocalizations',
      patchPath: '/v1/appInfoLocalizations',
      parentRel: { appInfo: rel('appInfos', appInfo.id) },
      attributes: listing.appInfo,
    }),
  );
  await step('Clasificación por edad', () => setAgeRating(appInfo.id));
  await step('Precio', () => setFreePrice(app.id));
  await step('Disponibilidad', () => setAvailability(app.id));
  await step('Copyright y publicación', () =>
    api.patch(`/v1/appStoreVersions/${version.id}`, {
      data: { type: 'appStoreVersions', id: version.id, attributes: { copyright: listing.copyright, releaseType: 'AFTER_APPROVAL' } },
    }),
  );
  await step('Descripción y palabras clave', async () => {
    versionLocId = await upsertLocalization({
      listPath: `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
      type: 'appStoreVersionLocalizations',
      patchPath: '/v1/appStoreVersionLocalizations',
      parentRel: { appStoreVersion: rel('appStoreVersions', version.id) },
      attributes: listing.version_localization,
    });
  });
  await step('Información para la revisión', () => setReviewDetail(version.id));
  await step('Build', () => attachBuild(app.id, version.id));
  if (versionLocId) await step('Capturas', () => uploadScreenshots(versionLocId));

  if (submit) {
    if (problems.length) {
      console.log('\nNo se envía a revisión: arregla antes lo marcado con ✗.');
    } else {
      await step('Envío a revisión', () => submitForReview(app.id, version.id));
    }
  }
  console.log(problems.length ? `\nPendiente:\n- ${problems.join('\n- ')}` : '\nTodo listo.');
  console.log('\nA mano en App Store Connect: Privacidad de la app (etiquetas) y, para la UE, la declaración de comerciante (DSA).');
  if (problems.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
