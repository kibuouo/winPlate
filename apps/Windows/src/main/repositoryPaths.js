const path = require('node:path');

const applicationRoot = path.resolve(__dirname, '..', '..');
const repositoryRoot = path.resolve(applicationRoot, '..', '..');

function resolveBackendPaths({
  isPackaged = false,
  resourcesPath,
  repositoryRoot: sourceRoot = repositoryRoot
} = {}) {
  if (isPackaged && !resourcesPath) {
    throw new Error('Packaged backend resolution requires resourcesPath.');
  }
  const backendRoot = isPackaged ? resourcesPath : sourceRoot;
  const backendAppDir = path.join(backendRoot, 'backend', 'local-api');
  return {
    backendAppDir,
    backendEntryPath: path.join(backendAppDir, 'winplate_local_api', 'main.py'),
    backendLogConfigPath: path.join(backendAppDir, 'logging.json')
  };
}

const { backendAppDir, backendEntryPath, backendLogConfigPath } = resolveBackendPaths();

function assetPath(...segments) {
  return path.join(applicationRoot, 'assets', ...segments);
}

module.exports = {
  applicationRoot,
  repositoryRoot,
  backendAppDir,
  backendEntryPath,
  backendLogConfigPath,
  resolveBackendPaths,
  assetPath
};
