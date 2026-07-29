const path = require('path');
const fs = require('fs');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// Gradle uses a short drive to keep CMake paths below Windows MAX_PATH. Resolve
// that alias here so Metro and pnpm refer to every dependency by one path.
const appRoot = fs.realpathSync.native(__dirname);
const workspaceRoot = fs.realpathSync.native(path.resolve(appRoot, '../..'));

function canonicalizeExistingPaths(value) {
  if (typeof value === 'string') {
    return path.isAbsolute(value) && fs.existsSync(value)
      ? fs.realpathSync.native(value)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeExistingPaths);
  }
  if (
    value
    && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null)
  ) {
    for (const [key, entry] of Object.entries(value)) {
      value[key] = canonicalizeExistingPaths(entry);
    }
  }
  return value;
}

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.json'];

function resolveAlias(moduleName) {
  if (!moduleName.startsWith('@/')) return null;
  const srcPath = path.resolve(appRoot, 'src');
  const relativePath = moduleName.replace('@/', '');
  const base = path.join(srcPath, relativePath);

  // 1. 直接作为目录，查找 index 文件
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of EXTENSIONS) {
      const indexFile = path.join(base, `index${ext}`);
      if (fs.existsSync(indexFile)) return indexFile;
    }
  }

  // 2. 直接作为文件，尝试追加扩展名
  if (fs.existsSync(base)) return base;
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(appRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    resolveRequest: (context, moduleName, platform) => {
      const aliased = resolveAlias(moduleName);
      if (aliased) {
        return {
          filePath: aliased,
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

const defaultConfig = canonicalizeExistingPaths(getDefaultConfig(appRoot));
const getPolyfills = defaultConfig.serializer.getPolyfills;
defaultConfig.serializer.getPolyfills = (...args) =>
  canonicalizeExistingPaths(getPolyfills(...args));

module.exports = mergeConfig(defaultConfig, config);
