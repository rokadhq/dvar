import { readFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const STATES = new Set(['planned', 'in_progress', 'implemented', 'verified']);
const EVIDENCE = ['implementation', 'tests', 'documentation', 'review'];

export function loadV1Catalog(root = repositoryRoot) {
  return JSON.parse(readFileSync(resolve(root, 'docs/v1/features.json'), 'utf8'));
}

export function validateV1Catalog(catalog, root = repositoryRoot) {
  const errors = [];
  if (catalog?.schemaVersion !== 1 || catalog?.target !== '1.0.0') errors.push('Invalid v1 catalog schema or target.');
  for (const key of ['onHold', 'ownerApproved', 'securityReviewApproved', 'compatibilityQualified']) {
    if (typeof catalog?.release?.[key] !== 'boolean') errors.push(`Missing boolean release gate: ${key}.`);
  }
  const features = Array.isArray(catalog?.features) ? catalog.features : [];
  if (features.length !== 55) errors.push('The v1 scope must contain exactly 55 feature records.');
  const expected = new Set(Array.from({ length: 55 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`));
  const seen = new Set();
  const definitions = new Map();
  const realRoot = realpathSync(root);
  for (const feature of features) {
    const id = feature?.id;
    if (!expected.has(id) || seen.has(id)) errors.push(`Unknown or duplicate feature id: ${id}.`);
    seen.add(id); definitions.set(id, feature);
    if (typeof feature?.name !== 'string' || !feature.name.trim()) errors.push(`${id}: missing name.`);
    if (!STATES.has(feature?.status)) errors.push(`${id}: invalid status.`);
    if (!['P0', 'P1', 'P2'].includes(feature?.priority)) errors.push(`${id}: invalid priority.`);
    if (!Object.hasOwn(catalog?.milestones ?? {}, feature?.milestone ?? '')) errors.push(`${id}: unknown milestone.`);
    if (!Array.isArray(feature?.acceptance) || feature.acceptance.length < 2
      || feature.acceptance.some(value => typeof value !== 'string' || value.trim().length < 20)) {
      errors.push(`${id}: at least two substantive acceptance criteria are required.`);
    }
    if (!Array.isArray(feature?.dependsOn) || new Set(feature.dependsOn).size !== feature.dependsOn.length) {
      errors.push(`${id}: invalid dependency list.`);
    }
    for (const kind of EVIDENCE) {
      const entries = feature?.evidence?.[kind];
      if (!Array.isArray(entries)) { errors.push(`${id}: missing ${kind} evidence list.`); continue; }
      const required = feature.status === 'verified' || (feature.status === 'implemented' && kind !== 'review');
      if (required && entries.length === 0) errors.push(`${id}: ${kind} evidence is required for ${feature.status}.`);
      for (const path of entries) {
        if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) {
          errors.push(`${id}: unsafe evidence path.`); continue;
        }
        try {
          const file = resolve(root, path);
          const rel = relative(realRoot, realpathSync(file));
          if (rel === '..' || rel.startsWith('../') || isAbsolute(rel) || !statSync(file).isFile()) throw new Error();
        } catch { errors.push(`${id}: ${kind} evidence file missing or outside repository: ${path}.`); }
      }
    }
  }
  for (const id of expected) if (!seen.has(id)) errors.push(`Missing feature: ${id}.`);
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    if (visiting.has(id)) { errors.push(`Cyclic dependency involving ${id}.`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const deps = definitions.get(id)?.dependsOn;
    for (const dep of Array.isArray(deps) ? deps : []) {
      if (!definitions.has(dep)) errors.push(`${id}: missing dependency ${dep}.`);
      else visit(dep);
    }
    visiting.delete(id); visited.add(id);
  };
  for (const id of definitions.keys()) visit(id);
  return errors;
}

export function releaseBlockers(catalog, version, root = repositoryRoot) {
  const blockers = validateV1Catalog(catalog, root);
  if (catalog?.release?.onHold !== false) blockers.push('Publication is on hold.');
  if (version !== '1.0.0') blockers.push('The first public release must be version 1.0.0.');
  for (const gate of ['ownerApproved', 'securityReviewApproved', 'compatibilityQualified']) {
    if (catalog?.release?.[gate] !== true) blockers.push(`Release sign-off missing: ${gate}.`);
  }
  const unfinished = (Array.isArray(catalog?.features) ? catalog.features : []).filter(feature => feature?.status !== 'verified');
  if (unfinished.length) blockers.push(`${unfinished.length} of 55 features are not verified.`);
  return blockers;
}
