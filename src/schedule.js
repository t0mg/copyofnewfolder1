/**
 * Schedule Module — cron-based scheduled post broadcasting.
 *
 * Manages the watermark tag that tracks the last cron execution,
 * scans markdown files for posts with `{time: ...}` tags that fall
 * within the current broadcast window, and collects them for the
 * main pipeline to process.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { parseFrontmatter, parseScheduleTag } from './parser.js';
import { createLogger } from './utils.js';

const log = createLogger('schedule');

/** Default watermark tag name. */
export const WATERMARK_TAG = 'yodelog-cron-watermark';

// ---------------------------------------------------------------------------
// Watermark management
// ---------------------------------------------------------------------------

/**
 * Read the timestamp stored in the watermark tag.
 * Uses the tagger date of an annotated tag.
 * Returns epoch-zero (1970-01-01) if the tag doesn't exist.
 *
 * @param {string} [tagName] - Git tag name (default: WATERMARK_TAG)
 * @returns {Date}
 */
export function getWatermarkTime(tagName = WATERMARK_TAG) {
  try {
    // Check if the tag exists
    const exists = execSync(`git tag -l ${tagName}`, { encoding: 'utf-8' }).trim();
    if (!exists) {
      log.info(`Watermark tag "${tagName}" not found — first run, using epoch zero`);
      return new Date(0);
    }

    // Read the tagger date from the annotated tag object
    const dateStr = execSync(
      `git for-each-ref --format="%(creatordate:iso-strict)" refs/tags/${tagName}`,
      { encoding: 'utf-8' }
    ).trim();

    if (!dateStr) {
      log.warn(`Could not read date from tag "${tagName}", using epoch zero`);
      return new Date(0);
    }

    const date = new Date(dateStr);
    log.info(`Watermark: ${date.toISOString()}`);
    return date;
  } catch (err) {
    log.error(`Failed to read watermark tag:`, err.message);
    return new Date(0);
  }
}

/**
 * Create or update the watermark tag to the given time, and push it.
 *
 * @param {Date} time - The timestamp to record
 * @param {string} [tagName] - Git tag name (default: WATERMARK_TAG)
 */
export function updateWatermark(time, tagName = WATERMARK_TAG) {
  const iso = time.toISOString();
  try {
    // Configure git identity for tagging (GitHub Actions may not have this)
    try {
      execSync('git config user.email "yodelog[bot]@users.noreply.github.com"', { stdio: 'pipe' });
      execSync('git config user.name "Yodelog Bot"', { stdio: 'pipe' });
    } catch {
      // Already configured, ignore
    }

    execSync(
      `git tag -af ${tagName} -m "Yodelog cron watermark: ${iso}"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    execSync(
      `git push -f origin refs/tags/${tagName}`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    log.info(`Watermark updated to ${iso}`);
  } catch (err) {
    log.error(`Failed to update watermark tag:`, err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Scheduled post scanning
// ---------------------------------------------------------------------------

/**
 * Scan a single markdown file for posts whose schedule time falls
 * within the window (watermark, now].
 *
 * @param {string} filePath - Path to the markdown file
 * @param {Date} watermark - Start of the window (exclusive)
 * @param {Date} now - End of the window (inclusive)
 * @returns {Array<{heading: string, rawContent: string, scheduledTime: Date}>}
 */
export function scanFileForScheduledPosts(filePath, watermark, now) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.error(`Failed to read ${filePath}:`, err.message);
    return [];
  }

  const frontmatter = parseFrontmatter(content);

  // Skip files not enrolled in yodelog
  if (!frontmatter.yodelog) return [];

  // Skip files that are push-only
  if (frontmatter.post_on === 'push') return [];

  // Strip the frontmatter to get the body
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // Split body into heading-delimited blocks
  const blocks = splitOnHeadings(body);
  const matched = [];

  for (const block of blocks) {
    const { cleanHeading, scheduledTime } = parseScheduleTag(block.heading);

    if (!scheduledTime) continue;

    // Check the time window: watermark < scheduledTime <= now
    if (scheduledTime > watermark && scheduledTime <= now) {
      log.info(`  ⏰ Scheduled post ready: "${cleanHeading}" @ ${scheduledTime.toISOString()}`);
      matched.push({
        heading: cleanHeading,
        rawContent: block.rawContent,
        scheduledTime,
      });
    }
  }

  return matched;
}

/**
 * Find all markdown files in the repository and scan for scheduled posts.
 *
 * @param {Date} watermark - Start of the window (exclusive)
 * @param {Date} now - End of the window (inclusive)
 * @returns {Array<{file: string, blocks: Array<{heading: string, rawContent: string}>, frontmatter: Object}>}
 */
export function getScheduledPosts(watermark, now) {
  let files;
  try {
    const output = execSync('git ls-files "*.md"', { encoding: 'utf-8' }).trim();
    files = output ? output.split('\n').filter(Boolean) : [];
  } catch (err) {
    log.error('Failed to list markdown files:', err.message);
    return [];
  }

  log.info(`Scanning ${files.length} markdown file(s) for scheduled posts`);
  log.info(`Window: ${watermark.toISOString()} → ${now.toISOString()}`);

  const results = [];

  for (const file of files) {
    if (!existsSync(file)) continue;

    const blocks = scanFileForScheduledPosts(file, watermark, now);
    if (blocks.length > 0) {
      log.info(`  ${file}: ${blocks.length} scheduled post(s) ready`);

      // Re-read frontmatter for the main pipeline to use
      let content;
      try {
        content = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      const frontmatter = parseFrontmatter(content);

      results.push({ file, blocks, frontmatter });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split a markdown body on `## ` headings (same logic as diff.js but
 * operates on full file content rather than diff output).
 *
 * @param {string} text
 * @returns {Array<{heading: string, rawContent: string}>}
 */
function splitOnHeadings(text) {
  const blocks = [];
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
