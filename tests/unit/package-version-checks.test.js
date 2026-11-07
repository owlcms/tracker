import { spawnSync } from 'child_process';
import https from 'https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTagExists, resolveTrackerCoreVersion } from '../../scripts/package-shared.js';

vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal(),
  spawnSync: vi.fn()
}));

const version = '2.0.0-rc01';
const ref = `refs/tags/${version}`;
const sha = '613b1a0dd04ef25f5f56dc5802beb6fdfc4728e6';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(spawnSync).mockReset();
});

describe('Remote tracker-core tag checks', () => {
  it('uses the exact remote tag even when the GitHub API would report it missing', async () => {
    const apiLookup = vi.spyOn(https, 'get').mockImplementation(() => {
      throw new Error('The GitHub API must not be used to check a remote tag');
    });
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: `${sha}\t${ref}\n`,
      stderr: ''
    });

    await expect(resolveTrackerCoreVersion({
      requestedVersion: version,
      requestedBranch: 'master',
      allowRelease: true
    })).resolves.toBe(version);

    expect(spawnSync).toHaveBeenCalledExactlyOnceWith('git', [
      'ls-remote', '--exit-code', '--refs',
      'https://github.com/owlcms/tracker-core.git', ref
    ], { encoding: 'utf8', shell: false });
    expect(apiLookup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rechecks an absent tag after two seconds and stops as soon as it is published', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 2, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: `${sha}\t${ref}\n`, stderr: '' });

    const check = checkTagExists('owlcms', 'tracker-core', version);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(check).resolves.toBe(true);
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a missing tag only after three absent results two seconds apart', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 2, stdout: '', stderr: '' });

    const check = checkTagExists('owlcms', 'tracker-core', version);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3999);
    expect(spawnSync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(check).resolves.toBe(false);
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a genuinely missing tag when automatic core release is disabled', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 2, stdout: '', stderr: '' });

    const assertion = expect(resolveTrackerCoreVersion({
      requestedVersion: version
    })).rejects.toThrow(`tracker-core version '${version}' does not exist`);
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it.each([
    '',
    `${sha}\t${ref}-other\n`,
    `${sha}\t${ref}^{}\n`
  ])('rejects successful output without the exact tag: %j', async (stdout) => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout, stderr: '' });

    await expect(checkTagExists('owlcms', 'tracker-core', version))
      .rejects.toThrow('git did not return the requested ref');
  });

  it('aborts instead of offering another release when the remote lookup fails', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 128,
      stdout: '',
      stderr: 'fatal: Authentication failed\n'
    });

    await expect(resolveTrackerCoreVersion({
      requestedVersion: version,
      requestedBranch: 'master',
      allowRelease: true
    })).rejects.toThrow(`Failed to check remote tag '${version}': fatal: Authentication failed`);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not mistake a failed recheck for another absent result', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 2, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 128, stdout: '', stderr: 'fatal: Could not resolve host\n' });

    const assertion = expect(checkTagExists('owlcms', 'tracker-core', version))
      .rejects.toThrow('fatal: Could not resolve host');
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces a missing Git executable', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: null,
      error: new Error('spawnSync git ENOENT')
    });

    await expect(checkTagExists('owlcms', 'tracker-core', version))
      .rejects.toThrow('spawnSync git ENOENT');
  });

  it('surfaces a terminated Git lookup', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: ''
    });

    await expect(checkTagExists('owlcms', 'tracker-core', version))
      .rejects.toThrow('git was terminated by SIGTERM');
  });
});
