import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { access } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const REPOS_BASE = join(process.cwd(), '.repos');

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
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

export async function prepareRepo({ repo, taskId, branch }) {
  const repoName = extractRepoName(repo);
  const repoDir = join(REPOS_BASE, repoName);
  const token = process.env.GITHUB_TOKEN;
  const authedUrl = injectToken(repo, token);
  const branchName = branch || `task/${taskId}`;

  if (await dirExists(repoDir)) {
    await git(['checkout', 'main'], repoDir);
    await git(['pull'], repoDir);
  } else {
    await git(['clone', authedUrl, repoDir], process.cwd());
  }

  await git(['checkout', '-b', branchName], repoDir);

  return repoDir;
}
