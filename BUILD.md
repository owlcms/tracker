# Building and Releasing OWLCMS Tracker

## Development Workflow

### Local Development with Linked Dependencies

When developing owlcms-tracker with local changes to tracker-core:

```bash
# 1. Install and link tracker-core globally (from tracker-core directory)
cd ../tracker-core
npm install
npm link

# 2. Install owlcms-tracker dependencies
cd ../owlcms-tracker
npm install

# 3. Link tracker-core in owlcms-tracker
npm link @owlcms/tracker-core

# 4. Start development server
npm run dev
```

Changes to tracker-core will be immediately reflected in owlcms-tracker.

> Note: If you run `npm install` (or `npm ci`) in `owlcms-tracker` later, npm may replace the symlink with the locked GitHub dependency. If that happens, just run `npm link @owlcms/tracker-core` again.

### Checking Link Status

```bash
# List linked packages
npm ls --link

# Check if tracker-core is a symlink
ls -l node_modules/@owlcms/tracker-core
```

## Release Process

### Prerequisites

Install GitHub CLI if not already installed:

```bash
# Windows (via winget)
winget install GitHub.cli

# Or download from: https://cli.github.com/

# Authenticate
gh auth login
```

### Automated Release Script

The `release` script automates the entire release workflow:

```bash
npm run release -- <version>
```

**Example:**
```bash
npm run release -- 2.4.0
```

**What the script does:**

1. **Validates version** - Checks semver format (X.Y.Z or X.Y.Z-beta01)
2. **Resolves tracker-core version** - Uses the provided version, or queries GitHub for the latest semver tag. Verifies publication with `git ls-remote --exit-code --refs` against the GitHub repository, not local tags or the GitHub REST API.
3. **Pins tracker-core in package.json** - Uses `npm pkg set` to set `@owlcms/tracker-core` to `github:owlcms/tracker-core#<version>`
4. **Updates package-lock.json** - Uses `npm install --package-lock-only` (does not touch `node_modules`, so it won't break local links)
5. **Commits changes** - Stages and commits `package.json`, `package-lock.json`, and `ReleaseNotes.md`
6. **Pushes to GitHub** - Uploads the commit
7. **Triggers workflow** - Uses `gh workflow run -f revision=<version>` to start build

A missing tag is checked up to three times, two seconds apart, before offering
to release tracker-core. Finding the exact remote tag stops the checks
immediately. Network, authentication, and Git failures stop the release with an
error instead of treating an already-published version as missing.

### Manual Release Steps (if needed)

If you need to perform steps manually:

```bash
# 1. Pin tracker-core to the desired tag
npm pkg set dependencies.@owlcms/tracker-core=github:owlcms/tracker-core#1.0.0-rc01

# 2. Update package-lock.json without touching node_modules
npm install --package-lock-only

# 3. Commit and push
git add package.json package-lock.json ReleaseNotes.md
git commit -m "chore: update tracker-core for release 2.4.0"
git push

# 4. Trigger workflow using gh CLI
gh workflow run release.yaml -f revision=2.4.0
```

## Release Workflow Details

### GitHub Actions Workflow

The release workflow (`.github/workflows/release.yaml`) performs:

1. **Dependency Installation** - Uses `npm ci` with exact package-lock.json versions
2. **Plugin Preparation** - Keeps only standard plugins for distribution
3. **Build Process** - Creates production builds for all platforms
4. **Package Creation**:
   - Windows (x64)
   - macOS ARM64 (M-series)
   - macOS x64 (Intel)
   - Raspberry Pi (ARM)
5. **Docker Image** - Builds and pushes to container registry
6. **GitHub Release** - Creates release with all packages and release notes

### Version Requirements

**Valid semver formats:**
- `X.Y.Z` - Standard release (e.g., `2.4.0`)
- `X.Y.Z-suffix` - Pre-release (e.g., `2.4.0-beta01`, `2.4.0-rc1`)

## Custom Zip Plugin Selection

The zip packager uses additive selectors. `--standard` adds the built-in plugins from the default checkout, and the other selectors add extra plugins, extensions, or full submodules on top.

Use the npm argument separator `--` before the tracker version and selector options. Without this separator, npm consumes the arguments and the zip script will not receive the version or selectors.

The first positional argument is the tracker version that appears in the output ZIP name:

```bash
npm run zip -- 2.18.0 --include-category documents
# creates dist/owlcms-tracker_2.18.0.zip
```

Use `--timestamp` to append timestamp metadata that is preserved when installed by the OWLCMS control panel:

```bash
npm run zip -- 2.18.0 --timestamp --include-category documents
# creates dist/owlcms-tracker_2.18.0+2026-05-12.14h37.zip
```

Selectors do not change the ZIP filename by themselves. Use `--name` to append install-preserved package metadata:

```bash
npm run zip -- 2.18.0 --name documents --include-category documents
# creates dist/owlcms-tracker_2.18.0+documents.zip
```

The control panel installs that package as `2.18.0+documents`. Metadata is sanitized for Windows filenames and control panel parsing; underscores become hyphens because the control panel extracts the version after the last underscore.

The optional second positional argument pins the tracker-core version:

```bash
npm run zip -- 2.18.0 1.5.5 --include-category documents
```

```bash
# Public-style package: only default-checkout built-ins
npm run zip -- 2.17.2 --standard
```

```bash
# Standard plugins plus all configured documents and remote-control plugins
npm run zip -- 2.17.2 --standard --include-categories documents,remote-control
```

`--include` can be repeated, and `--include-category`/`--include-categories` plus `--submodule`/`--submodules` both accept singular or plural forms.

```bash
npm run zip -- 2.17.2 --standard --include-category remote-control --include-categories team --submodule France
```

Selector notes:
- `--include` matches plugin display names only, for example `Referee Assignments` or `France - Équipes`.
- `--include-categories` matches the `category` declared in each plugin or extension `config.js`, for example `documents`, `remote-control`, or `team`.
- `--submodule` selects whole submodules such as `books`, `OBS`, or `France`.
- `--standard` includes only the built-in plugins present in the default checkout. It does not include runtime extensions or initialized submodules by itself.
- Any build that adds selectors beyond plain `--standard` writes a package-root `.custom-build` marker so the OWLCMS control panel can warn before replacing a customized tracker install.
- Selecting a category pulls in every plugin or extension whose `config.js` uses that category. If those matches live in plugin submodules or delegated extensions, the required backing content is included automatically.
- Selecting an extension automatically includes the plugin it delegates to via `delegateTo`, even if that base plugin was not named explicitly.
- Extensions are never included implicitly; they must be named by `--include`, `--include-categories`, or `--submodule`.
- `npm run zip -- <version>` currently behaves like `npm run zip -- <version> --standard`.

## Coordinated Releases (tracker-core + owlcms-tracker)

When releasing both packages together:

```bash
# 1. Release tracker-core first
cd ../tracker-core
npm run release 1.0.0-beta02

# 2. Release owlcms-tracker pinned to that tracker-core tag
cd ../owlcms-tracker
npm run release -- 2.4.0 1.0.0-beta02
```

## Troubleshooting

### GitHub CLI not installed

**Problem:** Script fails with "gh: command not found"

**Solution:** Install GitHub CLI

```bash
# Windows
winget install GitHub.cli

# Then authenticate
gh auth login
```

### "npm ci" fails with missing package

**Problem:** `npm ci` requires exact versions from package-lock.json

**Solution:** `npm ci` removes `node_modules` and installs exactly what's in `package-lock.json`. If you use `npm link`, run `npm ci` first, then re-link.

```bash
npm ci
npm link @owlcms/tracker-core
```

### Link is still present after release script

**Problem:** Script couldn't find tracker-core at sibling path

**Solution:** Manually re-link

```bash
cd ../tracker-core
npm link
cd ../owlcms-tracker
npm link @owlcms/tracker-core
```

### Wrong commit hash in package-lock.json

**Problem:** package-lock.json points to old commit

**Solution:** Re-pin the dependency and regenerate the lock file

```bash
npm pkg set dependencies.@owlcms/tracker-core=github:owlcms/tracker-core#1.0.0-rc01
npm install --package-lock-only
```

### Vite not picking up changes

**Problem:** Module caching after code changes

**Solution:** Restart dev server

```bash
# Stop server (Ctrl+C)
npm run dev
```

## Development Tips

### Learning Mode

Capture all WebSocket messages from OWLCMS for debugging:

```bash
npm run dev:learning
```

Messages are saved to `samples/message-[timestamp].json`

### Verify Exports

Check that all required exports are available:

```bash
cd ../tracker-core
node scripts/verify-exports.js
```

### Directory Structure Assumption

The prepare-release script assumes this directory layout:

```
Dev/
├── git/
│   ├── owlcms-tracker/
│   └── tracker-core/
```

If your directories are named differently, adjust the script or manually re-link after release.
