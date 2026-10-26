/**
 * Shared packaging helpers for build-zip.js and release.js
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import readline from 'readline';
import { execSync, spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { gt, valid } from 'semver';

export function promptConfirmation(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function getTrackerCoreDirtyStatus() {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: '../tracker-core',
    encoding: 'utf8',
    shell: false
  });

  if (result.error) {
    throw new Error(`Failed to check tracker-core working tree: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to check tracker-core working tree: ${(result.stderr || '').trim() || 'git status failed'}`);
  }

  return result.stdout.trim();
}

function trackerCoreDirtyPaths(statusText) {
  return statusText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const arrowIndex = line.indexOf('->');
      if (arrowIndex !== -1) {
        return line.slice(arrowIndex + 2).trim();
      }

      return line.substring(2).trim();
    });
}

export function fetchLatestGitHubTag(owner, repo) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/tags`,
      method: 'GET',
      headers: {
        'User-Agent': 'owlcms-version-checker',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    https.get(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${res.statusCode}: ${data.substring(0, 200)}`));
          return;
        }

        try {
          const tags = JSON.parse(data);

          if (!Array.isArray(tags) || tags.length === 0) {
            reject(new Error('No tags found in repository'));
            return;
          }

          const validTags = tags
            .map(tag => tag.name)
            .map(name => name.replace(/^v/, ''))
            .filter(version => valid(version))
            .sort((a, b) => (gt(a, b) ? -1 : gt(b, a) ? 1 : 0));

          if (validTags.length === 0) {
            reject(new Error('No valid semver tags found'));
            return;
          }

          resolve(validTags[0]);
        } catch (error) {
          reject(new Error(`Failed to parse GitHub API response: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Failed to fetch tags from GitHub: ${error.message}`));
    });
  });
}

export function checkTagExists(owner, repo, tag) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/git/refs/tags/${tag}`,
      method: 'GET',
      headers: {
        'User-Agent': 'owlcms-version-checker',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    https.get(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(true);
        } else if (res.statusCode === 404) {
          resolve(false);
        } else {
          reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Failed to check tag: ${error.message}`));
    });
  });
}

export async function resolveTrackerCoreVersion({
  requestedVersion,
  requestedBranch,
  promptOnAuto = false,
  allowRelease = false
} = {}) {
  let trackerCoreVersion = requestedVersion;

  if (!trackerCoreVersion) {
    trackerCoreVersion = await fetchLatestGitHubTag('owlcms', 'tracker-core');
    if (promptOnAuto) {
      const confirmed = await promptConfirmation(`Use tracker-core@${trackerCoreVersion}?`);
      if (!confirmed) {
        throw new Error('User cancelled version selection');
      }
    }
  }

  const exists = await checkTagExists('owlcms', 'tracker-core', trackerCoreVersion);
  if (!exists) {
    if (!allowRelease) {
      throw new Error(`tracker-core version '${trackerCoreVersion}' does not exist`);
    }

    const dirtyStatus = getTrackerCoreDirtyStatus();
    const dirtyPaths = trackerCoreDirtyPaths(dirtyStatus);
    const onlyReleaseNotesDirty =
      dirtyPaths.length === 1 && dirtyPaths[0] === 'ReleaseNotes.md';

    if (dirtyStatus && !onlyReleaseNotesDirty) {
      throw new Error(
        `tracker-core version '${trackerCoreVersion}' does not exist and ../tracker-core has uncommitted changes:\n${dirtyStatus}\n\nCommit or stash those changes before retrying deploy:fly.`
      );
    }

    if (!requestedBranch) {
      throw new Error(`tracker-core version '${trackerCoreVersion}' does not exist and no tracker-core branch was specified`);
    }

    const runRelease = await promptConfirmation(
      `tracker-core@${trackerCoreVersion} not found. Release it from branch ${requestedBranch} now?`
    );
    if (!runRelease) {
      throw new Error(`tracker-core version '${trackerCoreVersion}' not found`);
    }

    const releaseResult = spawnSync(
      path.resolve('../tracker-core/release.sh'),
      [trackerCoreVersion, requestedBranch],
      { stdio: 'inherit' }
    );
    if (releaseResult.status !== 0) {
      throw new Error(
        `tracker-core release failed for version ${trackerCoreVersion} on branch ${requestedBranch}`
      );
    }
    if (!await checkTagExists('owlcms', 'tracker-core', trackerCoreVersion)) {
      throw new Error(`tracker-core release completed but tag '${trackerCoreVersion}' is not visible on GitHub`);
    }
  }

  return trackerCoreVersion;
}

export function updateTrackerCoreDependency({ packageJsonPath, trackerCoreVersion }) {
  if (!packageJsonPath) {
    throw new Error('packageJsonPath is required to update tracker-core dependency');
  }
  updatePackageJsonDependency(packageJsonPath, trackerCoreVersion);
}

export function refreshPackageLock({ packageLockPath = 'package-lock.json' } = {}) {
  try {
    const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
    delete packageLock.packages?.['node_modules/@owlcms/tracker-core'];
    if (packageLock.dependencies) {
      delete packageLock.dependencies['@owlcms/tracker-core'];
    }
    fs.writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n');
    console.log('✓ Removed stale tracker-core entry from package-lock.json');
  } catch (error) {
    console.log('⚠️  Could not modify package-lock.json (will try fresh install)');
  }

  console.log('\n📥 Updating package-lock.json...');
  execSync('npm install --package-lock-only', { stdio: 'inherit' });
  console.log('✓ package-lock.json updated (node_modules unchanged)');
}

export async function runVersionChecks({
  requestedVersion,
  requestedBranch,
  promptOnAuto = false,
  allowRelease = false,
  updatePackageJson = false,
  updatePackageLockFile = false,
  packageJsonPath = 'package.json',
  packageLockPath = 'package-lock.json'
} = {}) {
  const trackerCoreVersion = await resolveTrackerCoreVersion({
    requestedVersion,
    requestedBranch,
    promptOnAuto,
    allowRelease
  });

  if (updatePackageJson) {
    updateTrackerCoreDependency({ packageJsonPath, trackerCoreVersion });
    console.log(`✓ Updated ${packageJsonPath} to tracker-core@${trackerCoreVersion}`);
  }

  if (updatePackageLockFile) {
    refreshPackageLock({ packageLockPath });
  }

  return trackerCoreVersion;
}

export function updatePackageJsonDependency(filePath, trackerCoreVersion) {
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies['@owlcms/tracker-core'] = `github:owlcms/tracker-core#${trackerCoreVersion}`;
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
}

export function prepareRuntimePackageJson(filePath) {
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  delete pkg.devDependencies;
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
}

function listDirectoryNames(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  return fs.readdirSync(rootDir)
    .filter((entry) => fs.statSync(path.join(rootDir, entry)).isDirectory())
    .sort((a, b) => a.localeCompare(b));
}

function readGitSubmodules(gitmodulesPath = '.gitmodules') {
  if (!fs.existsSync(gitmodulesPath)) return [];

  const gitmodules = fs.readFileSync(gitmodulesPath, 'utf8');
  const matches = [...gitmodules.matchAll(/\[submodule "([^"]+)"\][\s\S]*?path = ([^\r\n]+)/g)];

  return matches.map(([, name, submodulePathRaw]) => {
    const submodulePath = submodulePathRaw.trim();
    let type = 'other';
    let topLevel = null;

    if (submodulePath.startsWith('src/plugins/')) {
      type = 'plugin';
      topLevel = submodulePath.split(/[\\/]/)[2] || null;
    } else if (submodulePath.startsWith('extensions/')) {
      type = 'extension';
      topLevel = submodulePath.split(/[\\/]/)[1] || null;
    }

    return {
      name,
      path: submodulePath,
      type,
      topLevel,
      baseName: path.basename(submodulePath)
    };
  });
}

function normalizeRequestedSubmodules(selectedSubmodules = []) {
  return selectedSubmodules
    .map((item) => item.replace(/^[.][\\/]/, '').replace(/^src\/plugins[\\/]/, '').replace(/^extensions[\\/]/, '').trim())
    .filter(Boolean);
}

function normalizeRequestedPlugins(selectedPlugins = []) {
  return selectedPlugins
    .map((item) => item.replace(/^[.][\\/]/, '').replace(/^src\/plugins[\\/]/, '').replace(/^extensions[\\/]/, '').trim())
    .filter(Boolean);
}

function stripDiacritics(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getAliasKeys(value) {
  const normalized = value.replace(/\\/g, '/').trim().toLowerCase();
  const asciiNormalized = stripDiacritics(normalized);
  const compact = asciiNormalized.replace(/[^a-z0-9/]+/g, '');
  return Array.from(new Set([normalized, asciiNormalized, compact].filter(Boolean)));
}

function addAlias(aliasMap, alias, target) {
  if (!alias) return;

  for (const key of getAliasKeys(alias)) {
    const existing = aliasMap.get(key) || [];
    if (!existing.some((entry) => entry.id === target.id)) {
      existing.push(target);
      aliasMap.set(key, existing);
    }
  }
}

function getAliasMatches(aliasMap, value) {
  const matches = [];

  for (const key of getAliasKeys(value)) {
    for (const entry of aliasMap.get(key) || []) {
      if (!matches.some((match) => match.id === entry.id)) {
        matches.push(entry);
      }
    }
  }

  return matches;
}

function extractConfigValue(configContent, key) {
  const match = configContent.match(new RegExp(`${key}\\s*:\\s*['\"]([^'\"]+)['\"]`));
  return match ? match[1].trim() : null;
}

function extractPluginMetadata(configPath) {
  if (!fs.existsSync(configPath)) return null;

  const configContent = fs.readFileSync(configPath, 'utf8');
  return {
    configName: extractConfigValue(configContent, 'name'),
    configCategory: extractConfigValue(configContent, 'category')
  };
}

function discoverSourcePlugins(rootDir = 'src/plugins') {
  const plugins = [];

  const visit = (currentDir, prefix = '') => {
    if (!fs.existsSync(currentDir)) return;

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = path.join(currentDir, entry.name);
      const pluginPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const configPath = path.join(fullPath, 'config.js');

      if (fs.existsSync(configPath)) {
        const metadata = extractPluginMetadata(configPath) || {};
        plugins.push({
          id: `plugin:${pluginPath}`,
          kind: 'plugin',
          pluginPath,
          folderName: path.basename(pluginPath),
          topLevel: pluginPath.split('/')[0],
          configName: metadata.configName || null,
          configCategory: metadata.configCategory || null
        });
      }

      visit(fullPath, pluginPath);
    }
  };

  visit(rootDir);

  return plugins.sort((a, b) => a.pluginPath.localeCompare(b.pluginPath));
}

function discoverExtensionPlugins(rootDir = 'extensions') {
  const plugins = [];

  if (!fs.existsSync(rootDir)) return plugins;

  for (const repoName of listDirectoryNames(rootDir)) {
    const repoPath = path.join(rootDir, repoName);

    const visit = (currentDir, prefix = '') => {
      if (!fs.existsSync(currentDir)) return;

      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(currentDir, entry.name);
        const extensionPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const configPath = path.join(fullPath, 'config.js');

        if (fs.existsSync(configPath)) {
          const configContent = fs.readFileSync(configPath, 'utf8');
          const metadata = extractPluginMetadata(configPath) || {};
          plugins.push({
            id: `extension:${repoName}/${extensionPath}`,
            kind: 'extension-plugin',
            repoName,
            extensionPath,
            folderName: path.basename(extensionPath),
            configName: metadata.configName || null,
            configCategory: metadata.configCategory || null,
            delegateTarget: extractDelegateTarget(configContent)
          });
        }

        visit(fullPath, extensionPath);
      }
    };

    visit(repoPath);
  }

  return plugins.sort((a, b) => `${a.repoName}/${a.extensionPath}`.localeCompare(`${b.repoName}/${b.extensionPath}`));
}

function formatAvailablePluginNames(sourcePlugins, extensionPlugins) {
  const labels = new Set();

  for (const plugin of sourcePlugins) {
    labels.add(plugin.configName || plugin.folderName);
  }

  for (const plugin of extensionPlugins) {
    labels.add(plugin.configName || plugin.folderName);
  }

  return Array.from(labels).sort((a, b) => a.localeCompare(b)).join(', ');
}

export function isCustomBuild({
  includeStandard = false,
  selectedSubmodules = [],
  selectedPlugins = [],
  selectedPluginCategories = []
} = {}) {
  return !includeStandard
    || selectedSubmodules.length > 0
    || selectedPlugins.length > 0
    || selectedPluginCategories.length > 0;
}

function formatAvailablePluginCategories(sourcePlugins, extensionPlugins) {
  const labels = new Set();

  for (const plugin of sourcePlugins) {
    if (plugin.configCategory) {
      labels.add(plugin.configCategory);
    }
  }

  for (const plugin of extensionPlugins) {
    if (plugin.configCategory) {
      labels.add(plugin.configCategory);
    }
  }

  return Array.from(labels).sort((a, b) => a.localeCompare(b)).join(', ');
}

function describeResolvedPluginTarget(match) {
  if (match.kind === 'plugin') {
    return match.configName ? `${match.configName} (${match.pluginPath})` : match.pluginPath;
  }

  if (match.kind === 'extension-plugin') {
    const pluginLabel = match.plugin.configName || match.plugin.folderName;
    return `${pluginLabel} (extensions/${match.plugin.repoName}/${match.plugin.extensionPath})`;
  }

  return match.id;
}

function addPluginPathSelection(pluginPath, {
  sourcePluginPaths,
  submoduleByTopLevel,
  selectedStandardPluginPaths,
  selectedPluginSubmoduleTopLevels,
  missingPaths
}) {
  if (!pluginPath) return;

  const topLevel = pluginPath.split('/')[0];
  const owningSubmodule = submoduleByTopLevel.get(topLevel);

  if (owningSubmodule?.type === 'plugin') {
    if (!fs.existsSync(owningSubmodule.path)) {
      missingPaths.push(owningSubmodule.path);
      return;
    }

    selectedPluginSubmoduleTopLevels.add(owningSubmodule.topLevel);
    return;
  }

  if (sourcePluginPaths.has(pluginPath)) {
    selectedStandardPluginPaths.add(pluginPath);
    return;
  }

  missingPaths.push(path.join('src', 'plugins', pluginPath));
}

function resolveSelectedSubmodules(selectedSubmodules = []) {
  const allSubmodules = readGitSubmodules();
  const requested = normalizeRequestedSubmodules(selectedSubmodules);
  const aliasMap = new Map();

  for (const submodule of allSubmodules) {
    const aliases = new Set([
      submodule.name,
      submodule.path,
      submodule.baseName
    ]);

    if (submodule.topLevel) {
      aliases.add(submodule.topLevel);
    }

    for (const alias of aliases) {
      aliasMap.set(alias.toLowerCase(), submodule);
    }
  }

  const resolved = [];
  const missing = [];

  for (const item of requested) {
    const match = aliasMap.get(item.toLowerCase());
    if (match) {
      resolved.push(match);
    } else {
      missing.push(item);
    }
  }

  if (missing.length > 0) {
    const available = allSubmodules.map((submodule) => submodule.path).join(', ') || '(none)';
    throw new Error(`Requested submodule(s) not found: ${missing.join(', ')}. Available: ${available}`);
  }

  const uniqueResolved = requested.length === 0
    ? allSubmodules.filter((submodule) => fs.existsSync(submodule.path))
    : Array.from(new Map(resolved.map((submodule) => [submodule.path, submodule])).values());

  const missingPaths = uniqueResolved
    .filter((submodule) => !fs.existsSync(submodule.path))
    .map((submodule) => submodule.path);

  if (missingPaths.length > 0) {
    throw new Error(`Selected submodule path(s) are not available in this workspace: ${missingPaths.join(', ')}`);
  }

  return {
    all: allSubmodules,
    selected: uniqueResolved,
    hasSelection: requested.length > 0
  };
}

export function resolveSelectedPlugins({
  selectedPlugins = [],
  selectedPluginCategories = []
} = {}) {
  const allSubmodules = readGitSubmodules();
  const requestedNames = normalizeRequestedPlugins(selectedPlugins);
  const requestedCategories = normalizeRequestedPlugins(selectedPluginCategories);
  const sourcePlugins = discoverSourcePlugins();
  const extensionPlugins = discoverExtensionPlugins();
  const submoduleByTopLevel = new Map(
    allSubmodules
      .filter((submodule) => submodule.topLevel)
      .map((submodule) => [submodule.topLevel, submodule])
  );
  const sourcePluginPaths = new Set(sourcePlugins.map((plugin) => plugin.pluginPath));
  const nameAliasMap = new Map();
  const categoryAliasMap = new Map();

  for (const plugin of sourcePlugins) {
    addAlias(nameAliasMap, plugin.configName || plugin.folderName, plugin);
    addAlias(categoryAliasMap, plugin.configCategory, plugin);
  }

  for (const plugin of extensionPlugins) {
    const target = {
      id: plugin.id,
      kind: 'extension-plugin',
      plugin
    };

    addAlias(nameAliasMap, plugin.configName || plugin.folderName, target);
    addAlias(categoryAliasMap, plugin.configCategory, target);
  }

  const selectedStandardPluginPaths = new Set();
  const selectedPluginSubmoduleTopLevels = new Set();
  const selectedExtensionSubmoduleTopLevels = new Set();
  const missingNames = [];
  const missingCategories = [];
  const ambiguous = [];
  const missingPaths = [];
  const selectionContext = {
    sourcePluginPaths,
    submoduleByTopLevel,
    selectedStandardPluginPaths,
    selectedPluginSubmoduleTopLevels,
    missingPaths
  };

  const applyResolvedMatch = (match) => {
    if (match.kind === 'plugin') {
      addPluginPathSelection(match.pluginPath, selectionContext);
      return;
    }

    if (match.kind !== 'extension-plugin') {
      return;
    }

    const repoPath = path.join('extensions', match.plugin.repoName);
    if (!fs.existsSync(repoPath)) {
      missingPaths.push(repoPath);
      return;
    }

    selectedExtensionSubmoduleTopLevels.add(match.plugin.repoName);
    addPluginPathSelection(match.plugin.delegateTarget, selectionContext);
  };

  const resolveRequestedValues = (requested, aliasMap, missingList, label, allowMultipleMatches = false) => {
    for (const item of requested) {
      const matches = getAliasMatches(aliasMap, item);

      if (matches.length === 0) {
        missingList.push(item);
        continue;
      }

      if (!allowMultipleMatches && matches.length > 1) {
        ambiguous.push(`${label} ${item} -> ${matches.map(describeResolvedPluginTarget).join(', ')}`);
        continue;
      }

      for (const match of matches) {
        applyResolvedMatch(match);
      }
    }
  };

  resolveRequestedValues(requestedNames, nameAliasMap, missingNames, 'name');
  resolveRequestedValues(requestedCategories, categoryAliasMap, missingCategories, 'category', true);

  if (ambiguous.length > 0) {
    throw new Error(`Include selector(s) are ambiguous: ${ambiguous.join('; ')}`);
  }

  if (missingNames.length > 0 || missingCategories.length > 0) {
    const errors = [];

    if (missingNames.length > 0) {
      const availableNames = formatAvailablePluginNames(sourcePlugins, extensionPlugins) || '(none)';
      errors.push(`Requested plugin name(s) not found: ${missingNames.join(', ')}. Available plugin names: ${availableNames}`);
    }

    if (missingCategories.length > 0) {
      const availableCategories = formatAvailablePluginCategories(sourcePlugins, extensionPlugins) || '(none)';
      errors.push(`Requested plugin category(s) not found: ${missingCategories.join(', ')}. Available plugin categories: ${availableCategories}`);
    }

    throw new Error(errors.join(' '));
  }

  if (missingPaths.length > 0) {
    throw new Error(`Selected include target(s) are not available in this workspace: ${Array.from(new Set(missingPaths)).join(', ')}`);
  }

  return {
    hasSelection: requestedNames.length > 0 || requestedCategories.length > 0,
    selectedStandardPluginPaths,
    selectedPluginSubmoduleTopLevels,
    selectedExtensionSubmoduleTopLevels
  };
}

function computeAllowedTopLevelDirs({
  rootDir,
  type,
  selectedSubmodules = [],
  explicitSelectedTopLevels = []
}) {
  const currentDirs = listDirectoryNames(rootDir);
  const submodules = resolveSelectedSubmodules(selectedSubmodules);
  const selectedTopLevels = new Set(
    (submodules.hasSelection ? submodules.selected : [])
      .filter((submodule) => submodule.type === type && submodule.topLevel)
      .map((submodule) => submodule.topLevel)
  );

  for (const dir of explicitSelectedTopLevels) {
    selectedTopLevels.add(dir);
  }

  return currentDirs.filter((dir) => selectedTopLevels.has(dir));
}

function extractDelegateTarget(configContent) {
  const match = configContent.match(/delegateTo\s*:\s*['\"]([^'\"]+)['\"]/);
  return match ? match[1].trim() : null;
}

function findDelegatedPluginIds(extensionRepoNames = []) {
  const delegated = new Set();

  for (const repoName of extensionRepoNames) {
    const repoPath = path.join('extensions', repoName);
    if (!fs.existsSync(repoPath)) continue;

    for (const entry of fs.readdirSync(repoPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const configPath = path.join(repoPath, entry.name, 'config.js');
      if (!fs.existsSync(configPath)) continue;

      const delegateTarget = extractDelegateTarget(fs.readFileSync(configPath, 'utf8'));
      if (delegateTarget) {
        delegated.add(delegateTarget);
      }
    }
  }

  return delegated;
}

function pathMatchesAllowedRoots(relativePath, allowedRoots = new Set()) {
  const normalized = relativePath.split(path.sep).join('/');

  for (const root of allowedRoots) {
    if (normalized === root) {
      return true;
    }

    if (normalized.startsWith(`${root}/`)) {
      return true;
    }

    if (root.startsWith(`${normalized}/`)) {
      return true;
    }
  }

  return false;
}

function isPluginTestPath(parts) {
  const testDirNames = new Set(['test', 'tests', '__tests__']);
  const basename = parts[parts.length - 1] || '';

  return parts.some((part) => testDirNames.has(part))
    || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(basename);
}

export function computeBuildSelection({
  selectedSubmodules = [],
  explicitPluginSelection = null,
  includeStandard = false,
  allowedExtensionDirs = []
}) {
  const submodules = resolveSelectedSubmodules(selectedSubmodules);
  const pluginSelection = explicitPluginSelection || resolveSelectedPlugins();
  const explicitlySelectedSubmodules = submodules.hasSelection ? submodules.selected : [];
  const pluginSubmoduleTopLevels = new Set(
    submodules.all
      .filter((submodule) => submodule.type === 'plugin' && submodule.topLevel)
      .map((submodule) => submodule.topLevel)
  );
  const selectedPluginSubmoduleTopLevels = new Set([
    ...explicitlySelectedSubmodules
      .filter((submodule) => submodule.type === 'plugin' && submodule.topLevel)
      .map((submodule) => submodule.topLevel),
    ...pluginSelection.selectedPluginSubmoduleTopLevels
  ]);
  const delegatedPluginIds = findDelegatedPluginIds(allowedExtensionDirs);
  const allowedStandardPluginRoots = new Set([
    ...pluginSelection.selectedStandardPluginPaths,
    ...delegatedPluginIds
  ]);

  return {
    includeStandard,
    pluginSubmoduleTopLevels,
    selectedPluginSubmoduleTopLevels,
    allowedStandardPluginRoots,
    allowedExtensionDirs: new Set(allowedExtensionDirs),
    includeStandardExtensionFiles: true
  };
}

export function shouldCopyWorkspaceEntry(relativePath, isDirectory, selection) {
  const normalized = relativePath.split(path.sep).join('/');
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 0) {
    return true;
  }

  const topLevel = parts[0];
  if (['.git', 'node_modules', 'build', 'dist', '.svelte-kit', '.vite', '.idea', '.vscode'].includes(topLevel)) {
    return false;
  }

  if (topLevel === 'extensions') {
    if (parts.length === 1) return true;
    if (parts[1] === 'README.md') {
      return selection.includeStandardExtensionFiles;
    }
    return selection.allowedExtensionDirs.has(parts[1]);
  }

  if (topLevel === 'src' && parts[1] === 'plugins') {
    if (parts.length <= 2) return true;
    if (isPluginTestPath(parts.slice(2))) {
      return false;
    }

    const category = parts[2];
    const pluginRelativePath = parts.slice(2).join('/');
    if (selection.pluginSubmoduleTopLevels.has(category)) {
      return selection.selectedPluginSubmoduleTopLevels.has(category);
    }

    if (selection.includeStandard) {
      return true;
    }

    return pathMatchesAllowedRoots(pluginRelativePath, selection.allowedStandardPluginRoots);
  }

  return true;
}

function copyWorkspaceForBuild(sourceRoot, workspaceRoot, selection) {
  const copyRecursive = (currentSourceDir, currentDestDir, relativeDir = '') => {
    fs.mkdirSync(currentDestDir, { recursive: true });

    for (const entry of fs.readdirSync(currentSourceDir, { withFileTypes: true })) {
      const entrySourcePath = path.join(currentSourceDir, entry.name);
      const entryRelativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

      if (!shouldCopyWorkspaceEntry(entryRelativePath, entry.isDirectory(), selection)) {
        continue;
      }

      const entryDestPath = path.join(currentDestDir, entry.name);
      if (entry.isDirectory()) {
        copyRecursive(entrySourcePath, entryDestPath, entryRelativePath);
      } else {
        fs.mkdirSync(path.dirname(entryDestPath), { recursive: true });
        fs.copyFileSync(entrySourcePath, entryDestPath);
      }
    }
  };

  copyRecursive(sourceRoot, workspaceRoot);
}

function linkBuildWorkspaceNodeModules(repoRoot, workspaceRoot) {
  const sourceNodeModules = path.join(repoRoot, 'node_modules');
  const workspaceNodeModules = path.join(workspaceRoot, 'node_modules');

  if (!fs.existsSync(sourceNodeModules)) {
    throw new Error(`Required dependency directory not found: ${sourceNodeModules}`);
  }

  if (fs.existsSync(workspaceNodeModules)) {
    fs.rmSync(workspaceNodeModules, { recursive: true, force: true });
  }

  fs.symlinkSync(sourceNodeModules, workspaceNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
}

/**
 * Scan plugins for additional dependencies declared in config.js
 * Looks in src/plugins/ (source) and selected extensions/ (runtime)
 * @returns {string[]} Array of npm package specifiers to install
 */
function scanPluginDependencies({ srcPluginsDir = 'src/plugins', extensionsDir = 'extensions', allowedExtensionDirs = [] } = {}) {
  const deps = new Set();
  
  // Scan source plugins (nested: src/plugins/category/plugin-name/)
  if (fs.existsSync(srcPluginsDir)) {
    const categories = fs.readdirSync(srcPluginsDir);
    for (const category of categories) {
      const categoryPath = path.join(srcPluginsDir, category);
      if (fs.statSync(categoryPath).isDirectory()) {
        scanPluginDir(categoryPath, deps);
      }
    }
  }
  
  // Scan extensions (nested structure: extensions/RepoName/plugin-name/)
  if (fs.existsSync(extensionsDir)) {
    const repos = allowedExtensionDirs ?? [];
    for (const repo of repos) {
      const repoPath = path.join(extensionsDir, repo);
      scanPluginDir(repoPath, deps);
    }
  }

  return Array.from(deps);
}

function copySelectedExtensions({ distDir, sourceDir = 'extensions', includeStandardFiles = true, allowedExtensionDirs = [] }) {
  const destDir = path.join(distDir, 'extensions');

  fs.mkdirSync(destDir, { recursive: true });

  if (includeStandardFiles && fs.existsSync(path.join(sourceDir, 'README.md'))) {
    fs.copyFileSync(path.join(sourceDir, 'README.md'), path.join(destDir, 'README.md'));
    console.log('✓ Copied extensions/README.md');
  }

  if (!fs.existsSync(sourceDir)) {
    return 0;
  }

  for (const repo of allowedExtensionDirs) {
    copyDir(path.join(sourceDir, repo), path.join(destDir, repo));
    console.log(`✓ Copied extensions/${repo}`);
  }

  return allowedExtensionDirs.length;
}

function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	const files = fs.readdirSync(src);
	files.forEach(file => {
		const srcPath = path.join(src, file);
		const destPath = path.join(dest, file);
		if (fs.statSync(srcPath).isDirectory()) {
			copyDir(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	});
}

async function extractDefaultOptionsFromConfig(configPath) {
  if (!fs.existsSync(configPath)) return [];

  const configMtime = fs.statSync(configPath).mtimeMs;
  const configUrl = `${pathToFileURL(configPath).href}?t=${configMtime}`;
  const configModule = await import(configUrl);
  const config = configModule.default || configModule;

  if (!Array.isArray(config?.options)) return [];

  return config.options
    .filter((option) => option?.key && Object.prototype.hasOwnProperty.call(option, 'default'))
    .map((option) => ({
      key: option.key,
      default: option.default
    }));
}

async function writeGeneratedConfigOverride({ configPath, destPath }) {
  const defaults = await extractDefaultOptionsFromConfig(configPath);
  if (defaults.length === 0) return false;

  const payload = {
    options: defaults.map(({ key, default: defaultValue }) => ({ key, default: defaultValue }))
  };

  const content = [
    '// Runtime default overrides for this plugin.',
    '// The tracker reads only options[].default from this file.',
    '// JSON5 syntax: comments and trailing commas are allowed.',
    JSON.stringify(payload, null, 2),
    ''
  ].join('\n');

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, content);
  return true;
}

async function copyOrGenerateConfigOverride({ pluginDir, buildWorkspaceDir, distDir }) {
  const configPath = path.join(pluginDir, 'config.js');
  if (!fs.existsSync(configPath)) return;

  const overridePath = path.join(pluginDir, 'config-override.json5');
  if (fs.existsSync(overridePath)) {
    const relativeOverride = path.relative(buildWorkspaceDir, overridePath);
    const dest = path.join(distDir, relativeOverride);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(overridePath, dest);
    console.log(`✓ Copied ${relativeOverride}`);
    return;
  }

  const generatedPath = path.join(pluginDir, 'config-override.json5');
  const relativeGenerated = path.relative(buildWorkspaceDir, generatedPath);
  const generatedDest = path.join(distDir, relativeGenerated);
  if (await writeGeneratedConfigOverride({ configPath, destPath: generatedDest })) {
    console.log(`✓ Generated ${relativeGenerated}`);
  }
}

/**
 * Scan a directory for plugins with config.js containing additionalDependencies
 */
function scanPluginDir(dir, deps) {
  if (!fs.existsSync(dir)) return;
  
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const entryPath = path.join(dir, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;
    
    const configPath = path.join(entryPath, 'config.js');
    if (!fs.existsSync(configPath)) continue;
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      
      // Look for additionalDependencies array in the config
      const match = configContent.match(/additionalDependencies\s*:\s*\[([^\]]*)\]/);
      if (match) {
        const depsArray = match[1]
          .split(',')
          .map(s => s.trim().replace(/['"]/g, ''))
          .filter(s => s.length > 0);
        
        for (const dep of depsArray) {
          deps.add(dep);
          console.log(`  📎 ${entry} requires: ${dep}`);
        }
      }
    } catch (err) {
      console.log(`  ⚠️ Could not parse ${entry}/config.js: ${err.message}`);
    }
  }
}

export async function buildAndPackage({
  distDir,
  version,
  trackerCoreVersion,
  updateDistDependency = true,
  selectedSubmodules = [],
  selectedPlugins = [],
  selectedPluginCategories = [],
  includeStandard = false
}) {
  const DIST_DIR = distDir || 'dist/package';
  const BUILD_WORKSPACE_DIR = path.join('dist', 'build-workspace');
  const repoRoot = process.cwd();
  const customBuild = isCustomBuild({
    includeStandard,
    selectedSubmodules,
    selectedPlugins,
    selectedPluginCategories
  });
  const explicitPluginSelection = resolveSelectedPlugins({
    selectedPlugins,
    selectedPluginCategories
  });
  const allowedExtensionDirs = computeAllowedTopLevelDirs({
    rootDir: 'extensions',
    type: 'extension',
    selectedSubmodules,
    explicitSelectedTopLevels: Array.from(explicitPluginSelection.selectedExtensionSubmoduleTopLevels)
  });
  const buildSelection = computeBuildSelection({
    selectedSubmodules,
    explicitPluginSelection,
    includeStandard,
    allowedExtensionDirs
  });

  // Ensure dist directory exists
  fs.mkdirSync('dist', { recursive: true });

  if (fs.existsSync(BUILD_WORKSPACE_DIR)) {
    fs.rmSync(BUILD_WORKSPACE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BUILD_WORKSPACE_DIR, { recursive: true });
  copyWorkspaceForBuild(repoRoot, BUILD_WORKSPACE_DIR, buildSelection);
  linkBuildWorkspaceNodeModules(repoRoot, BUILD_WORKSPACE_DIR);

  // Discover which plugins/extensions are present in the build workspace so the
  // .custom-build marker can record the exact list for the control panel to compare.
  const workspaceSourcePlugins = discoverSourcePlugins(path.join(BUILD_WORKSPACE_DIR, 'src/plugins'));
  const workspaceExtensionPlugins = discoverExtensionPlugins(path.join(BUILD_WORKSPACE_DIR, 'extensions'));
  const includedPluginNames = [
    ...workspaceSourcePlugins.map(p => p.configName || p.folderName),
    ...workspaceExtensionPlugins.map(p => p.configName || p.folderName)
  ].sort((a, b) => a.localeCompare(b));

  try {
    // Clean dist directory
    if (fs.existsSync(DIST_DIR)) {
      fs.rmSync(DIST_DIR, { recursive: true });
    }
    fs.mkdirSync(DIST_DIR, { recursive: true });

    // Remove experimental plugins (manual runs)
    if (fs.existsSync(path.join(BUILD_WORKSPACE_DIR, 'src/plugins/experiments'))) {
      fs.rmSync(path.join(BUILD_WORKSPACE_DIR, 'src/plugins/experiments'), { recursive: true });
      console.log('✓ Removed src/plugins/experiments');
    }

    // Build application in isolated workspace to avoid mutating the live repo
    console.log('\n🏗️  Building application...');
    execSync('npm run build', {
      cwd: BUILD_WORKSPACE_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
        PATH: `${path.join(repoRoot, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`
      }
    });

    // Remove pre-compressed files (server-side only)
    execSync("find build/client -name '*.gz' -delete", { cwd: BUILD_WORKSPACE_DIR, stdio: 'inherit' });
    execSync("find build/client -name '*.br' -delete", { cwd: BUILD_WORKSPACE_DIR, stdio: 'inherit' });
    console.log('✓ Removed .gz and .br files from build');

    // Copy required files
    const filesToCopy = [
      'start-with-ws.js',
      'package.json',
      'categories.json'
    ];

    filesToCopy.forEach(file => {
      const sourcePath = path.join(BUILD_WORKSPACE_DIR, file);
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, path.join(DIST_DIR, file));
        console.log(`✓ Copied ${file}`);
      }
    });

    // Update tracker-core dependency inside the packaged copy
    if (updateDistDependency && trackerCoreVersion) {
      updatePackageJsonDependency(path.join(DIST_DIR, 'package.json'), trackerCoreVersion);
      console.log(`✓ Set tracker-core@${trackerCoreVersion} in packaged package.json`);
    }
    prepareRuntimePackageJson(path.join(DIST_DIR, 'package.json'));
    console.log('✓ Removed development dependencies from packaged package.json');

    // Copy build directory
    copyDir(path.join(BUILD_WORKSPACE_DIR, 'build'), path.join(DIST_DIR, 'build'));
    console.log('✓ Copied build/');

    // Copy runtime assets from any plugin (at any nesting depth) that has them.
    // These are loose files needed at runtime (e.g., OBS scene collection templates
    // and editable config-override.json5 default overrides). Normal plugin JS is not
    // copied; it is either bundled by Vite or loaded as a runtime extension.
    const pluginsDir = path.join(BUILD_WORKSPACE_DIR, 'src/plugins');
    if (fs.existsSync(pluginsDir)) {
      const findPluginRuntimeAssets = async (dir) => {
        await copyOrGenerateConfigOverride({
          pluginDir: dir,
          buildWorkspaceDir: BUILD_WORKSPACE_DIR,
          distDir: DIST_DIR
        });

        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const child = path.join(dir, entry.name);
          if (entry.isDirectory() && entry.name === 'templates') {
            const relativeChild = path.relative(BUILD_WORKSPACE_DIR, child);
            copyDir(child, path.join(DIST_DIR, relativeChild));
            console.log(`✓ Copied ${relativeChild}`);
          } else if (entry.isDirectory()) {
            await findPluginRuntimeAssets(child);
          }
        }
      };
      await findPluginRuntimeAssets(pluginsDir);
    }

    // Copy explicitly selected extensions (runtime plugins), or create an empty folder with README.
    const workspaceExtensionsDir = path.join(BUILD_WORKSPACE_DIR, 'extensions');
    const copied = copySelectedExtensions({
      distDir: DIST_DIR,
      sourceDir: workspaceExtensionsDir,
      includeStandardFiles: true,
      allowedExtensionDirs
    });
    if (copied === 0) {
      console.log('✓ No runtime extensions selected; created extensions/ with README only');
    }

    // Install production dependencies only
    console.log('\n📥 Installing production dependencies...');
    execSync(`npm install --omit=dev --prefix ${DIST_DIR} --no-package-lock --no-save`, { stdio: 'inherit' });

    // Scan source plugins for additional dependencies and install them
    const workspaceAdditionalDeps = scanPluginDependencies({
      srcPluginsDir: path.join(BUILD_WORKSPACE_DIR, 'src/plugins'),
      extensionsDir: workspaceExtensionsDir,
      allowedExtensionDirs
    });
    if (workspaceAdditionalDeps.length > 0) {
      console.log(`\n📦 Installing plugin additional dependencies: ${workspaceAdditionalDeps.join(', ')}`);
      execSync(`npm install --omit=dev --prefix ${DIST_DIR} --no-package-lock --no-save ${workspaceAdditionalDeps.join(' ')}`, { stdio: 'inherit' });
    }

    // Remove any accidental self-dependency (prevents recursive packaging)
    const selfDepPath = path.join(DIST_DIR, 'node_modules', 'owlcms-tracker');
    if (fs.existsSync(selfDepPath)) {
      fs.rmSync(selfDepPath, { recursive: true });
      console.log('✓ Removed nested node_modules/owlcms-tracker');
    }
    const lockPath = path.join(DIST_DIR, 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      fs.rmSync(lockPath);
      console.log('✓ Removed package-lock.json from package');
    }

    // Create README
    const readme = `OWLCMS Competition Tracker
==========================

This package contains the tracker application files.
It is intended to be launched by the OWLCMS control panel.

REQUIREMENTS:
=============
- Node.js 22+ installed (https://nodejs.org/)

MANUAL LAUNCH (if needed):
==========================
  node start-with-ws.js

OWLCMS CONFIGURATION:
====================
In OWLCMS, go to:
  Prepare Competition → Language and System Settings → Connections
  
Set "URL for Video Data" to:
  ws://localhost:8096/ws

The tracker will receive competition data automatically.
`;

    fs.writeFileSync(path.join(DIST_DIR, 'README.txt'), readme);
    console.log('✓ Created README.txt');

    if (customBuild) {
      const pluginLine = includedPluginNames.length > 0
        ? `plugins: ${includedPluginNames.join(', ')}`
        : 'plugins: (none)';
      fs.writeFileSync(path.join(DIST_DIR, '.custom-build'), [
        'This tracker package was built with custom selection options.',
        'Updating it from the OWLCMS control panel may replace custom plugins or extensions.',
        pluginLine,
        ''
      ].join('\n'));
      console.log(`✓ Created .custom-build marker (${includedPluginNames.length} plugins)`);
    }

    // Create zip
    console.log('\n📦 Creating ZIP archive...');
    const zipName = version ? `owlcms-tracker_${version}.zip` : 'owlcms-tracker.zip';

    if (fs.existsSync(`dist/${zipName}`)) {
      fs.unlinkSync(`dist/${zipName}`);
    }

    const isWindows = process.platform === 'win32';
    if (isWindows) {
      const sevenZipPath = fs.existsSync('C:/Program Files/7-Zip/7z.exe')
        ? '"C:/Program Files/7-Zip/7z.exe"'
        : '7z';
      try {
        execSync(`${sevenZipPath} a -tzip ../${zipName} .`, { cwd: DIST_DIR, stdio: 'inherit' });
      } catch {
        execSync(`powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${DIST_DIR}', 'dist/${zipName}')"`, { stdio: 'inherit' });
      }
    } else {
      execSync(`cd ${DIST_DIR} && zip -r ../${zipName} .`, { stdio: 'inherit' });
    }

    console.log(`\n✅ Package created: dist/${zipName}`);

    const stats = fs.statSync(`dist/${zipName}`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } finally {
    if (fs.existsSync(BUILD_WORKSPACE_DIR)) {
      fs.rmSync(BUILD_WORKSPACE_DIR, { recursive: true, force: true });
    }
  }
}
