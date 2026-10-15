// Fail closed if the source-checkout gate or its evidence is unavailable.
// This lifecycle is not invoked when consumers install Dvar.
try {
  await import('../../../scripts/check-v1-release.mjs');
} catch {
  console.error('Dvar cannot be published without the complete reviewed v1 source-checkout release gate.');
  process.exitCode = 1;
}
