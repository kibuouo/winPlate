const path = require('node:path');

const applicationRoot = path.resolve(__dirname, '..', '..');
const repositoryRoot = path.resolve(applicationRoot, '..', '..');
const backendEntryPath = path.join(repositoryRoot, 'backend', 'main.py');

function assetPath(...segments) {
  return path.join(applicationRoot, 'assets', ...segments);
}

module.exports = { applicationRoot, repositoryRoot, backendEntryPath, assetPath };
