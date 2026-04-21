/**
 * Shared utility functions for Yodelog.
 *
 * Zero-dependency helpers for grapheme counting, URL detection,
 * BlueSky facet generation, and general text manipulation.
 */

// ---------------------------------------------------------------------------
// Grapheme counting (BlueSky uses grapheme length, not char length)
// ---------------------------------------------------------------------------

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Count the number of grapheme clusters in a string.
 * BlueSky's 300-character limit is actually 300 graphemes.
 * @param {string} text
 * @returns {number}
 */
export function countGraphemes(text) {
  return [...segmenter.segment(text)].length;
}

/**
 * Convert a grapheme index to a UTF-8 byte offset.
 * BlueSky facets use byte offsets, not character offsets.
 * @param {string} text
 * @param {number} graphemeIndex
 * @returns {number}
 */
export function graphemeIndexToByteOffset(text, graphemeIndex) {
  const segments = [...segmenter.segment(text)];
  let byteOffset = 0;
  for (let i = 0; i < graphemeIndex && i < segments.length; i++) {
    byteOffset += new TextEncoder().encode(segments[i].segment).byteLength;
  }
  return byteOffset;
}

/**
 * Get the UTF-8 byte length of a string.
 * @param {string} text
 * @returns {number}
 */
export function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

// ---------------------------------------------------------------------------
// URL and mention detection
// ---------------------------------------------------------------------------

/**
 * Regex to match URLs in text. Captures http(s) URLs.
 */
const URL_REGEX = /https?:\/\/[^\s\]\)]+/g;

/**
 * Regex to match hashtags. Captures # followed by word characters.
 */
const HASHTAG_REGEX = /(?<=\s|^)#[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF][\w\u00C0-\u024F\u1E00-\u1EFF]*/g;

/**
 * Find all URLs in text with their positions.
 * @param {string} text
 * @returns {Array<{text: string, start: number, end: number}>}
 */
export function findUrls(text) {
  const matches = [];
  let match;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    matches.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}

/**
 * Find all hashtags in text with their positions.
 * @param {string} text
 * @returns {Array<{text: string, tag: string, start: number, end: number}>}
 */
export function findHashtags(text) {
  const matches = [];
  let match;
  HASHTAG_REGEX.lastIndex = 0;
  while ((match = HASHTAG_REGEX.exec(text)) !== null) {
    matches.push({
      text: match[0],
      tag: match[0].slice(1), // without the #
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}

// ---------------------------------------------------------------------------
// BlueSky facet generation
// ---------------------------------------------------------------------------

/**
 * Generate BlueSky richtext facets for URLs and hashtags in text.
 * Facets use UTF-8 byte offsets.
 * @param {string} text
 * @returns {Array<Object>} BlueSky facet objects
 */
export function generateBskyFacets(text) {
  const encoder = new TextEncoder();
  const facets = [];

  // URL facets
  for (const url of findUrls(text)) {
    const byteStart = encoder.encode(text.slice(0, url.start)).byteLength;
    const byteEnd = encoder.encode(text.slice(0, url.end)).byteLength;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{
        $type: 'app.bsky.richtext.facet#link',
        uri: url.text,
      }],
    });
  }

  // Hashtag facets
  for (const tag of findHashtags(text)) {
    const byteStart = encoder.encode(text.slice(0, tag.start)).byteLength;
    const byteEnd = encoder.encode(text.slice(0, tag.end)).byteLength;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{
        $type: 'app.bsky.richtext.facet#tag',
        tag: tag.tag,
      }],
    });
  }

  return facets;
}

// ---------------------------------------------------------------------------
// Mastodon URL-adjusted length
// ---------------------------------------------------------------------------

/** Mastodon counts all URLs as 23 characters, regardless of actual length. */
const MASTODON_URL_LENGTH = 23;

/**
 * Calculate the effective character count for Mastodon.
 * URLs are counted as 23 characters regardless of actual length.
 * @param {string} text
 * @returns {number}
 */
export function mastodonCharCount(text) {
  const urls = findUrls(text);
  let adjustment = 0;
  for (const url of urls) {
    adjustment += url.text.length - MASTODON_URL_LENGTH;
  }
  return text.length - adjustment;
}

// ---------------------------------------------------------------------------
// Image markdown extraction
// ---------------------------------------------------------------------------

/**
 * Regex to match Markdown image syntax: ![alt](path)
 */
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Extract all Markdown images from text.
 * @param {string} text
 * @returns {Array<{fullMatch: string, alt: string, path: string, index: number}>}
 */
export function extractImages(text) {
  const images = [];
  let match;
  IMAGE_REGEX.lastIndex = 0;
  while ((match = IMAGE_REGEX.exec(text)) !== null) {
    images.push({
      fullMatch: match[0],
      alt: match[1],
      path: match[2],
      index: match.index,
    });
  }
  return images;
}

/**
 * Strip all Markdown image syntax from text and clean up whitespace.
 * @param {string} text
 * @returns {string}
 */
export function stripImages(text) {
  return text.replace(IMAGE_REGEX, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a thread_style template with current/total values.
 * @param {string} template - e.g. "{current}/{total} 🧵" or "[{current}/{total}]"
 * @param {number} current
 * @param {number} total
 * @returns {string}
 */
export function formatThreadStyle(template, current, total) {
  return template
    .replace('{current}', String(current))
    .replace('{total}', String(total));
}

/**
 * Get MIME type from file extension.
 * @param {string} filePath
 * @returns {string}
 */
export function mimeFromPath(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const mimeMap = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Simple logger that prefixes messages with a tag.
 * @param {string} tag
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
export function createLogger(tag) {
  return {
    info: (...args) => console.log(`[${tag}]`, ...args),
    warn: (...args) => console.warn(`[${tag}] ⚠`, ...args),
    error: (...args) => console.error(`[${tag}] ✖`, ...args),
  };
}
