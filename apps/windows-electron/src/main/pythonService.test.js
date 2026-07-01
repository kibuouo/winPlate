const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { backendPythonArgs } = require('./pythonService');
const { repositoryRoot } = require('./repositoryPaths');

test('backend starts the importable package on the loopback service port', () => {
  assert.deepEqual(backendPythonArgs(), [
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
});
