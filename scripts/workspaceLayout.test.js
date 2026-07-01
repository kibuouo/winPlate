const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');

const requiredBoundaries = [
  'apps/windows-electron',
  'apps/macos',
  'apps/ios',
  'apps/watchos',
  'packages/core',
  'packages/shared-types',
  'packages/icons',
  'backend/local-api',
];

test('multi-platform workspace boundaries exist', () => {
  for (const boundary of requiredBoundaries) {
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, boundary)),
      true,
      `missing workspace boundary: ${boundary}`,
    );
  }
});
