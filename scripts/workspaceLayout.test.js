const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');

const requiredBoundaries = [
  'apps/windows-electron',
  'apps/macos',
  'apps/macos/WinPlate',
  'apps/ios',
  'apps/watchos',
  'packages/core',
  'packages/shared-types',
  'packages/icons',
  'backend/local-api',
];

const expectedWorkspaces = [
  'apps/windows-electron',
  'packages/core',
  'packages/shared-types',
  'packages/icons',
];

const expectedWorkspaceNames = new Map([
  ['apps/windows-electron', '@winplate/windows-electron'],
  ['packages/core', '@winplate/core'],
  ['packages/shared-types', '@winplate/shared-types'],
  ['packages/icons', '@winplate/icons'],
]);

const architectureDocs = [
  'docs/architecture.md',
  'docs/notification-center.md',
  'docs/platform-roadmap.md',
];

function readManifest(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, relativePath, 'package.json'), 'utf8'),
  );
}

test('root declares the exact application and package workspaces', () => {
  const rootManifest = readManifest('.');

  assert.equal(rootManifest.private, true);
  assert.deepEqual(rootManifest.workspaces, expectedWorkspaces);
});

test('every workspace has a private uniquely named manifest', () => {
  const names = [];

  for (const [workspace, expectedName] of expectedWorkspaceNames) {
    const manifest = readManifest(workspace);
    assert.equal(manifest.private, true, `${workspace} must be private`);
    assert.equal(manifest.name, expectedName, `${workspace} has the wrong package name`);
    names.push(manifest.name);
  }

  assert.equal(new Set(names).size, expectedWorkspaceNames.size);
});

test('multi-platform workspace boundaries exist', () => {
  for (const boundary of requiredBoundaries) {
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, boundary)),
      true,
      `missing workspace boundary: ${boundary}`,
    );
  }
});

test('Windows Electron source and assets live inside their application workspace', () => {
  assert.equal(fs.existsSync(path.join(repositoryRoot, 'apps/windows-electron/src/main/main.js')), true);
  assert.equal(fs.existsSync(path.join(repositoryRoot, 'apps/windows-electron/assets/icon.ico')), true);
});

test('platform clients cannot import each other', () => {
  const windowsRoot = path.join(repositoryRoot, 'apps/windows-electron');
  const sourceFiles = [];
  const collect = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(target);
      else if (/\.(?:js|json|css|html)$/.test(entry.name) && !entry.name.endsWith(".test.js")) {
        sourceFiles.push(target);
      }
    }
  };

  collect(windowsRoot);
  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /macos\/|electron-menubar|createMacMenuBar|platform-darwin|["']darwin["']/);
  }
  assert.equal(fs.existsSync(path.join(repositoryRoot, 'apps/macos/electron-menubar')), false);
});

test('README links every required architecture document', () => {
  const readme = fs.readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8');
  for (const document of architectureDocs) {
    assert.equal(fs.existsSync(path.join(repositoryRoot, document)), true, `missing ${document}`);
    assert.match(readme, new RegExp(document.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
