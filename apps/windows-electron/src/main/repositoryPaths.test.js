const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  repositoryRoot,
  backendEntryPath,
  assetPath,
  resolveBackendPaths
} = require('./repositoryPaths');

test('repository paths stay anchored when launched from the nested application directory', () => {
  const previousCwd = process.cwd();
  const expectedRoot = path.resolve(__dirname, '..', '..', '..', '..');

  process.chdir(path.join(expectedRoot, 'apps', 'windows-electron'));
  try {
    assert.equal(repositoryRoot, expectedRoot);
    assert.equal(
      backendEntryPath,
      path.join(expectedRoot, 'backend', 'local-api', 'winplate_local_api', 'main.py')
    );
    assert.equal(assetPath('icon.ico'), path.resolve(__dirname, '..', '..', 'assets', 'icon.ico'));
  } finally {
    process.chdir(previousCwd);
  }
});

test('packaged backend paths resolve below Electron resources', () => {
  const resourcesPath = path.join('C:', 'Program Files', 'WinPlate', 'resources');
  const paths = resolveBackendPaths({ isPackaged: true, resourcesPath });

  assert.equal(paths.backendAppDir, path.join(resourcesPath, 'backend', 'local-api'));
  assert.equal(
    paths.backendEntryPath,
    path.join(resourcesPath, 'backend', 'local-api', 'winplate_local_api', 'main.py')
  );
});
