import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { access, mkdir, writeFile, unlink, rm } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const REPOS_BASE = join(process.cwd(), '.repos');
const WORKTREES_BASE = process.env.WORKTREES_BASE || '/tmp/job-manager-tasks';

function extractRepoName(repoUrl) {
  const match = repoUrl.match(/\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Cannot extract repo name from URL: ${repoUrl}`);
  return match[1];
}

function injectToken(repoUrl, token) {
  if (!token) return repoUrl;
  return repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
}

async function dirExists(dirPath) {
  try {
    await access(dirPath);
    return true;
  } catch {
    return false;
  }
}

async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 120000 });
  return stdout.trim();
}

/**
 * Lockfile-based concurrency guard for bare clone init/fetch.
 * Prevents multiple concurrent tasks from racing on the same bare repo.
 */
async function withLock(lockPath, fn) {
  const maxRetries = 30;
  const retryDelay = 1000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await writeFile(lockPath, `${process.pid}`, { flag: 'wx' });
      try {
        return await fn();
      } finally {
        await unlink(lockPath).catch(() => {});
      }
    } catch (err) {
      if (err.code === 'EEXIST') {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to acquire lock: ${lockPath} after ${maxRetries} retries`);
}

/**
 * Ensures a bare clone exists at .repos/<name>.git
 * Uses a lockfile to prevent concurrent clone/fetch races.
 */
async function ensureBareClone(repoUrl, repoName) {
  const bareDir = join(REPOS_BASE, `${repoName}.git`);
  const lockPath = join(REPOS_BASE, `${repoName}.lock`);
  const token = process.env.GITHUB_TOKEN;
  const authedUrl = injectToken(repoUrl, token);

  await mkdir(REPOS_BASE, { recursive: true });

  await withLock(lockPath, async () => {
    if (await dirExists(bareDir)) {
      await git(['fetch', '--all', '--prune'], bareDir);
    } else {
      await git(['clone', '--bare', authedUrl, bareDir], REPOS_BASE);
    }
  });

  return bareDir;
}

/**
 * Creates a git worktree for the given task.
 * Returns the worktree directory path.
 */
export async function prepareRepo({ repo, taskId, branch }) {
  const repoName = extractRepoName(repo);
  const bareDir = await ensureBareClone(repo, repoName);

  const worktreeDir = join(WORKTREES_BASE, taskId);
  const branchName = branch || `task/${taskId}`;

  await mkdir(WORKTREES_BASE, { recursive: true });

  // Remove stale worktree if it exists
  if (await dirExists(worktreeDir)) {
    await git(['worktree', 'remove', '--force', worktreeDir], bareDir).catch(() => {});
    await rm(worktreeDir, { recursive: true, force: true });
  }

  await git(['worktree', 'add', worktreeDir, '-b', branchName, 'origin/main'], bareDir);

  // Set up remote URL with token so the worktree can push
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const authedUrl = injectToken(repo, token);
    await git(['remote', 'set-url', 'origin', authedUrl], worktreeDir);
  }

  return worktreeDir;
}

/**
 * Cleans up a worktree after task completion.
 */
export async function cleanupWorktree({ taskId }) {
  const worktreeDir = join(WORKTREES_BASE, taskId);

  if (!(await dirExists(worktreeDir))) return;

  // Try git worktree remove first — find the bare repo from worktree's .git file
  try {
    const gitContent = await import('node:fs/promises').then(fs =>
      fs.readFile(join(worktreeDir, '.git'), 'utf8')
    );
    const bareDir = gitContent.replace('gitdir: ', '').split('/worktrees/')[0].trim();
    await git(['worktree', 'remove', '--force', worktreeDir], bareDir);
  } catch {
    // Fallback: just remove the directory
    await rm(worktreeDir, { recursive: true, force: true });
  }
}
