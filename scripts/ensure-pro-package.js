/**
 * Ensure packages/pro exists for pro dev builds.
 *
 * Supports:
 * - packages/pro already present (cloned into core)
 * - monorepo layout with pro at ../../pro relative to core/packages/
 */
const fs = require('fs');
const path = require('path');

function hasProPackage(dir) {
  return fs.existsSync(path.join(dir, 'contributes.pro.json'));
}

function main() {
  const coreRoot = process.cwd();
  const packagesDir = path.join(coreRoot, 'packages');
  const packagesPro = path.join(packagesDir, 'pro');

  if (hasProPackage(packagesPro)) {
    return;
  }

  const monorepoPro = path.join(coreRoot, '..', 'pro');
  if (hasProPackage(monorepoPro)) {
    fs.mkdirSync(packagesDir, { recursive: true });
    const relativeTarget = path.relative(packagesDir, monorepoPro);
    fs.symlinkSync(relativeTarget, packagesPro, 'dir');
    console.log(`Linked packages/pro -> ${relativeTarget}`);
    return;
  }

  throw new Error(
    'packages/pro not found. Clone NexQL-Pro into core/packages/pro, or open the nexql-oss monorepo with pro/ beside core/.'
  );
}

main();
