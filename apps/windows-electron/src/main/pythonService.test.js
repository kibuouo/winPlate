const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { resolveBackendLaunch } = require('./pythonService');
const { repositoryRoot } = require('./repositoryPaths');
const packageManifest = require('../../package.json');

test('Electron packaging copies the local API below resources', () => {
  assert.deepEqual(packageManifest.build.extraResources, [{
    from: '../../backend/local-api',
    to: 'backend/local-api'
  }]);
});

test('backend logging configuration is present and parseable', () => {
  const loggingConfigPath = path.join(repositoryRoot, 'backend', 'local-api', 'logging.json');
  const loggingConfig = JSON.parse(fs.readFileSync(loggingConfigPath, 'utf8'));

  assert.equal(loggingConfig.version, 1);
  assert.equal(loggingConfig.handlers.default.stream, 'ext://sys.stderr');
  assert.equal(loggingConfig.handlers.access.stream, 'ext://sys.stdout');
});

test('development starts the importable package with the repository virtualenv', () => {
  const venvPython = path.join(repositoryRoot, '.venv', 'Scripts', 'python.exe');
  const launch = resolveBackendLaunch({
    platform: 'win32',
    repositoryRoot,
    userDataPath: path.join(repositoryRoot, '.test-user-data'),
    existsSync: (candidate) => candidate === venvPython
  });

  assert.equal(launch.command, venvPython);
  assert.deepEqual(launch.args, [
    '-m',
    'uvicorn',
    'winplate_local_api.main:api',
    '--app-dir',
    path.join(repositoryRoot, 'backend', 'local-api'),
    '--host',
    '127.0.0.1',
    '--port',
    '8765',
    '--log-config',
    path.join(repositoryRoot, 'backend', 'local-api', 'logging.json')
  ]);
  assert.equal(launch.env.WINPLATE_DATA_DIR, path.join(repositoryRoot, '.test-user-data'));
});

test('packaged mode resolves source below resources and uses a configured interpreter', () => {
  const resourcesPath = path.join('C:', 'Program Files', 'WinPlate', 'resources');
  const configuredPython = path.join('C:', 'Python', 'python.exe');
  const launch = resolveBackendLaunch({
    isPackaged: true,
    resourcesPath,
    userDataPath: path.join('C:', 'Users', 'test', 'WinPlate'),
    platform: 'win32',
    env: { WINPLATE_PYTHON: configuredPython },
    existsSync: (candidate) => candidate === configuredPython
  });

  assert.equal(launch.command, configuredPython);
  assert.equal(launch.args[4], path.join(resourcesPath, 'backend', 'local-api'));
});

test('packaged mode fails fast when no backend executable or interpreter exists', () => {
  assert.throws(
    () => resolveBackendLaunch({
      isPackaged: true,
      resourcesPath: path.join('C:', 'WinPlate', 'resources'),
      userDataPath: path.join('C:', 'Users', 'test', 'WinPlate'),
      platform: 'win32',
      env: {},
      existsSync: () => false
    }),
    /No packaged WinPlate backend runtime was found.*WINPLATE_PYTHON/
  );
});
