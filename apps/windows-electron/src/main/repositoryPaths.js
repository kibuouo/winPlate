const path = require('node:path');

const applicationRoot = path.resolve(__dirname, '..', '..');
const repositoryRoot = path.resolve(applicationRoot, '..', '..');
const backendAppDir = path.join(repositoryRoot, 'backend', 'local-api');
const backendEntryPath = path.join(backendAppDir, 'winplate_local_api', 'main.py');
const backendLogConfigPath = path.join(backendAppDir, 'logging.json');

function assetPath(...segments) {
  return path.join(applicationRoot, 'assets', ...segments);
}

module.exports = {
  applicationRoot,
  repositoryRoot,
  backendAppDir,
  backendEntryPath,
  backendLogConfigPath,
  assetPath
};
