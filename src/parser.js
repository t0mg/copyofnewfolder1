/**
 * Content Parser — frontmatter extraction and content block processing.
 *
 * Handles:
 * - YAML frontmatter parsing (lightweight, no dependency)
 * - Content block structuring (heading, text, images, manual thread breaks)
 */

import { readFileSync } from 'node:fs';
import { extractImages, stripImages, createLogger } from './utils.js';

const log = createLogger('parser');

/**
 * @typedef {Object} Frontmatter
 * @property {boolean} yodelog - Whether this file is a broadcast file
 * @property {string} prefix - Prepended to the first post in a thread
 * @property {string} suffix - Appended to the last post in a thread
 * @property {string} thread_style - Thread numbering format template
 * @property {'push'|'schedule'|'push_or_schedule'} post_on - Broadcasting mode
 */

/** Valid values for the `post_on` frontmatter key. */
const VALID_MODES = ['push', 'schedule', 'push_or_schedule'];

/** Default frontmatter values. */
const DEFAULTS = {
  yodelog: false,
  prefix: '',
  suffix: '',
  thread_style: '',
  post_on: 'push_or_schedule',
};

/**
 * Parse YAML frontmatter from a markdown file's content.
 * Lightweight parser — supports flat key-value pairs only.
 * Handles quoted and unquoted string values, booleans, and numbers.
 *
 * @param {string} content - Full file content
 * @returns {Frontmatter}
 */
export function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return { ...DEFAULTS };

  const yaml = fmMatch[1];
  const result = { ...DEFAULTS };

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    // Strip inline comments (but not inside quoted strings)
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const commentIndex = value.indexOf('#');
      if (commentIndex > 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Type coercion
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\d+$/.test(value)) value = parseInt(value, 10);

    if (key in DEFAULTS) {
      result[key] = value;
    }
  }

  // Validate post_on
  if (!VALID_MODES.includes(result.post_on)) {
    log.warn(`Invalid post_on "${result.post_on}", falling back to "push_or_schedule"`);
    result.post_on = 'push_or_schedule';
  }

  return result;
}

/**
 * Read a file and extract its frontmatter.
 * @param {string} filePath
 * @returns {Frontmatter}
 */
export function readFrontmatter(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return parseFrontmatter(content);
  } catch (err) {
    log.error(`Failed to read ${filePath}:`, err.message);
    return { ...DEFAULTS };
  }
}

/**
 * @typedef {Object} ContentChunk
 * @property {string} text - The text content (with image markdown stripped)
 * @property {string} rawText - The original text (with image markdown intact, for position tracking)
 * @property {Array<{alt: string, path: string}>} images - Images attached to this chunk
 */

/**
 * @typedef {Object} ProcessedPost
 * @property {string} heading - The post heading (empty string if `##` was used alone)
 * @property {ContentChunk[]} chunks - Content chunks (split by manual `---` breaks)
 */

/**
 * Process a raw content block from the diff engine into a structured post.
 *
 * Steps:
 * 1. If heading is non-empty, prepend it to the content (as the first line).
 * 2. Split on manual thread breaks (`---` on its own line).
 * 3. For each chunk, extract images and strip image markdown from text.
 *
 * @param {{heading: string, rawContent: string}} block
 * @returns {ProcessedPost}
 */
export function processBlock(block) {
  const { heading, rawContent } = block;

  // Build full content: do not include heading in the broadcast messages
  const fullContent = rawContent || '';

  // Split on manual thread breaks: a line that is exactly `---`
  // (not frontmatter, since we're past that stage)
  const manualChunks = splitOnManualBreaks(fullContent);

  const chunks = manualChunks.map(chunkText => {
    const images = extractImages(chunkText).map(img => ({
      alt: img.alt,
      path: img.path,
    }));
    const text = stripImages(chunkText);
    return { text, rawText: chunkText, images };
  });

  return { heading, chunks };
}

/**
 * Split content on manual thread breaks (`---` on its own line).
 * A `---` must be:
 * - On its own line (possibly with surrounding whitespace)
 * - Not at the very start (that would be frontmatter territory)
 *
 * @param {string} content
 * @returns {string[]}
 */
function splitOnManualBreaks(content) {
  // Split on lines that are exactly `---` (with optional whitespace)
  const parts = content.split(/\n\s*---\s*\n/);
  return parts.map(p => p.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Schedule tag parsing
// ---------------------------------------------------------------------------

/**
 * Regex to match a `{time: <ISO8601>}` tag in a heading.
 * Captures the ISO 8601 date string.
 */
const SCHEDULE_TAG_REGEX = /\{time:\s*([^}]+)\}/;

/**
 * Parse a `{time: ...}` schedule tag from a heading string.
 *
 * @param {string} heading - The raw heading text (without the `## ` prefix)
 * @returns {{ cleanHeading: string, scheduledTime: Date|null }}
 */
export function parseScheduleTag(heading) {
  const match = heading.match(SCHEDULE_TAG_REGEX);
  if (!match) {
    return { cleanHeading: heading, scheduledTime: null };
  }

  const raw = match[1].trim();
  const date = new Date(raw);

  if (isNaN(date.getTime())) {
    log.warn(`Invalid schedule time "${raw}" in heading "${heading}"`);
    return { cleanHeading: heading, scheduledTime: null };
  }

  const cleanHeading = heading.replace(SCHEDULE_TAG_REGEX, '').replace(/  +/g, ' ').trim();
  return { cleanHeading, scheduledTime: date };
}
