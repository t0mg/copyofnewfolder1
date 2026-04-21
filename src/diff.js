/**
 * Git Diff Engine — append-only log reader.
 *
 * Extracts only newly-added content from git diffs.
 * Strict rule: only lines starting with `+` are considered.
 * Modifications to existing lines are ignored to prevent re-posting.
 */

import { execSync } from 'node:child_process';
import { createLogger } from './utils.js';

const log = createLogger('diff');

/** SHA representing an empty git tree (used for first-ever commit diffs). */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf899d15d4a18e0c1';

/**
 * Get list of modified/added .md files between two commits.
 * @param {string} beforeSha
 * @param {string} afterSha
 * @returns {string[]} Array of file paths
 */
export function getChangedMarkdownFiles(beforeSha, afterSha) {
  const effectiveBefore = isNullSha(beforeSha) ? EMPTY_TREE_SHA : beforeSha;

  try {
    const output = execSync(
      `git diff --name-only --diff-filter=AMR ${effectiveBefore} ${afterSha} -- "*.md"`,
      { encoding: 'utf-8' }
    ).trim();

    if (!output) return [];
    return output.split('\n').filter(Boolean);
  } catch (err) {
    log.error('Failed to get changed files:', err.message);
    return [];
  }
}

/**
 * Extract newly-added content blocks from a git diff for a specific file.
 * Only processes lines starting with `+` (additions).
 * Groups consecutive additions into blocks and filters for blocks
 * starting with `## ` (new post headings).
 *
 * @param {string} beforeSha
 * @param {string} afterSha
 * @param {string} filePath
 * @returns {Array<{heading: string, rawContent: string}>}
 */
export function extractAddedBlocks(beforeSha, afterSha, filePath) {
  const effectiveBefore = isNullSha(beforeSha) ? EMPTY_TREE_SHA : beforeSha;

  let diffOutput;
  try {
    diffOutput = execSync(
      `git diff -U0 ${effectiveBefore} ${afterSha} -- "${filePath}"`,
      { encoding: 'utf-8' }
    );
  } catch (err) {
    log.error(`Failed to diff ${filePath}:`, err.message);
    return [];
  }

  const lines = diffOutput.split('\n');
  const addedGroups = [];
  let currentGroup = [];

  for (const line of lines) {
    // Skip diff headers (+++, ---, @@)
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      // A hunk header breaks continuity — flush current group
      if (currentGroup.length > 0) {
        addedGroups.push(currentGroup);
        currentGroup = [];
      }
      continue;
    }

    if (line.startsWith('+')) {
      // Strip the leading `+` and add to current group
      currentGroup.push(line.slice(1));
    } else {
      // Any non-addition line (context, deletion) breaks continuity
      if (currentGroup.length > 0) {
        addedGroups.push(currentGroup);
        currentGroup = [];
      }
    }
  }

  // Don't forget the last group
  if (currentGroup.length > 0) {
    addedGroups.push(currentGroup);
  }

  // Now filter and structure: only keep groups that start with `## `
  // We need to find `## ` within groups — a group might contain
  // multiple posts separated by `## `, so we split accordingly.
  const blocks = [];

  for (const group of addedGroups) {
    const joined = group.join('\n');
    // Split on `## ` headings (keeping the heading with its content)
    const parts = splitOnHeadings(joined);

    for (const part of parts) {
      blocks.push(part);
    }
  }

  return blocks;
}

/**
 * Split a text block into sub-blocks at `## ` heading boundaries.
 * Each returned block includes its heading and the content following it.
 *
 * @param {string} text
 * @returns {Array<{heading: string, rawContent: string}>}
 */
function splitOnHeadings(text) {
  const blocks = [];
  // Match ## at the start of a line (with optional trailing text)
  const headingRegex = /^##(?:[ \t]+(.*))?$/gm;
  const matches = [...text.matchAll(headingRegex)];

  if (matches.length === 0) return [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const heading = (match[1] || '').trim();
    const startAfterHeading = match.index + match[0].length;
    const endOfContent = i + 1 < matches.length
      ? matches[i + 1].index
      : text.length;

    const rawContent = text.slice(startAfterHeading, endOfContent).trim();
    blocks.push({ heading, rawContent });
  }

  return blocks;
}

/**
 * Main entry: get all new post blocks across all changed files.
 *
 * @param {string} beforeSha
 * @param {string} afterSha
 * @returns {Array<{file: string, blocks: Array<{heading: string, rawContent: string}>}>}
 */
export function getNewPosts(beforeSha, afterSha) {
  const files = getChangedMarkdownFiles(beforeSha, afterSha);
  log.info(`Found ${files.length} changed .md file(s)`);

  const results = [];
  for (const file of files) {
    const blocks = extractAddedBlocks(beforeSha, afterSha, file);
    if (blocks.length > 0) {
      log.info(`  ${file}: ${blocks.length} new post(s)`);
      results.push({ file, blocks });
    }
  }

  return results;
}

/**
 * Check if a SHA is the null/zero SHA (used for new branches / first push).
 * @param {string} sha
 * @returns {boolean}
 */
function isNullSha(sha) {
  return !sha || /^0+$/.test(sha);
}
