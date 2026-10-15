import { loadV1Catalog, validateV1Catalog } from './v1-plan.mjs';
try {
  const catalog = loadV1Catalog();
  const errors = validateV1Catalog(catalog);
  if (errors.length) throw new Error(errors.join('\n'));
  const verified = catalog.features.filter(feature => feature.status === 'verified').length;
  console.log(`Dvar v1 plan valid: 55 tracked features; ${verified} verified; publication on hold=${catalog.release.onHold}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid v1 plan.');
  process.exitCode = 1;
}
