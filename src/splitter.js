/**
 * Thread Splitter — smart content splitting for platform character limits.
 *
 * Handles:
 * - Auto-threading: splits long chunks at safe boundaries
 * - Thread numbering via thread_style template
 * - Prefix/suffix application
 * - Image proximity preservation during splits
 */

import {
  countGraphemes,
  mastodonCharCount,
  formatThreadStyle,
  extractImages,
  stripImages,
  createLogger,
} from './utils.js';

const log = createLogger('splitter');

/**
 * @typedef {Object} PlatformConfig
 * @property {string} name - Platform name ('mastodon' or 'bluesky')
 * @property {number} charLimit - Character limit per post
 * @property {'char'|'grapheme'} countMode - How to count characters
 */

/** @type {PlatformConfig} */
export const MASTODON_CONFIG = {
  name: 'mastodon',
  charLimit: 500,
  countMode: 'char',
};

/** @type {PlatformConfig} */
export const BLUESKY_CONFIG = {
  name: 'bluesky',
  charLimit: 300,
  countMode: 'grapheme',
};

/**
 * Count the effective length of text for a given platform.
 * @param {string} text
 * @param {PlatformConfig} platform
 * @returns {number}
 */
function countLength(text, platform) {
  if (platform.countMode === 'grapheme') {
    return countGraphemes(text);
  }
  return mastodonCharCount(text);
}

/**
 * Split content chunks into platform-appropriate thread posts.
 *
 * @param {Array<{text: string, images: Array<{alt: string, path: string}>}>} chunks
 *   Content chunks (already split by manual `---` breaks)
 * @param {PlatformConfig} platform
 * @param {{prefix: string, suffix: string, thread_style: string}} options
 * @returns {Array<{text: string, images: Array<{alt: string, path: string}>}>}
 *   Final thread posts ready for broadcasting
 */
export function splitForPlatform(chunks, platform, options) {
  const { prefix, suffix, thread_style } = options;

  // First pass: split any oversized chunks
  let splitChunks = [];
  for (const chunk of chunks) {
    const subChunks = autoSplitChunk(chunk, platform, options);
    splitChunks.push(...subChunks);
  }

  // Second pass: apply prefix, suffix, and thread numbering
  const total = splitChunks.length;
  const isThread = total > 1;

  const result = splitChunks.map((chunk, index) => {
    let text = chunk.text;
    const isFirst = index === 0;
    const isLast = index === total - 1;

    // Apply prefix to first post
    if (isFirst && prefix) {
      text = prefix + text;
    }

    // Apply suffix to last post (or single post)
    if (isLast && suffix) {
      text = text + ' ' + suffix;
    }

    // Apply thread numbering if it's a thread and style is configured
    if (isThread && thread_style) {
      const label = formatThreadStyle(thread_style, index + 1, total);
      text = text + ' ' + label;
    }

    return { text, images: chunk.images };
  });

  // Validate final lengths
  for (let i = 0; i < result.length; i++) {
    const len = countLength(result[i].text, platform);
    if (len > platform.charLimit) {
      log.warn(
        `[${platform.name}] Post ${i + 1}/${total} exceeds limit ` +
        `(${len}/${platform.charLimit}). Content may be truncated by the platform.`
      );
    }
  }

  return result;
}

/**
 * Auto-split a single chunk if it exceeds the platform limit.
 * Splits at the safest boundary in order of precedence:
 * 1. Paragraph break (\n\n)
 * 2. Sentence end (. or ? or ! followed by space)
 * 3. Space character
 *
 * @param {{text: string, images: Array<{alt: string, path: string}>}} chunk
 * @param {PlatformConfig} platform
 * @param {{prefix: string, suffix: string, thread_style: string}} options
 * @returns {Array<{text: string, images: Array<{alt: string, path: string}>}>}
 */
function autoSplitChunk(chunk, platform, options) {
  const { prefix, suffix, thread_style } = options;

  // Calculate the overhead to reserve for decorations.
  // Worst case: prefix + suffix + thread_style all on same post (single-post thread).
  // For multi-post: first has prefix + style, last has suffix + style, middle has style only.
  // We use a conservative estimate: reserve space for all decorations.
  const maxStyleLen = thread_style
    ? countLength(formatThreadStyle(thread_style, 99, 99), platform) + 1 // +1 for space
    : 0;
  const prefixLen = prefix ? countLength(prefix, platform) : 0;
  const suffixLen = suffix ? countLength(suffix + ' ', platform) : 0;
  const overhead = Math.max(prefixLen, suffixLen) + maxStyleLen;
  const effectiveLimit = platform.charLimit - overhead;

  if (effectiveLimit <= 0) {
    log.warn(`[${platform.name}] Decoration overhead exceeds character limit!`);
    return [chunk];
  }

  const textLen = countLength(chunk.text, platform);
  if (textLen <= effectiveLimit) {
    return [chunk];
  }

  // Need to split — recursively split at the best boundary
  const parts = splitAtBoundary(chunk.text, effectiveLimit, platform);

  // Distribute images using proximity rule on the raw (unstripped) text,
  // which still contains the image markdown for position tracking.
  return distributeImages(parts, chunk.rawText || chunk.text, chunk.images, platform);
}

/**
 * Split text at the best safe boundary within the character limit.
 * Returns an array of text parts.
 *
 * @param {string} text
 * @param {number} limit
 * @param {PlatformConfig} platform
 * @returns {string[]}
 */
function splitAtBoundary(text, limit, platform) {
  if (countLength(text, platform) <= limit) {
    return [text];
  }

  // Find split point within the limit
  const splitPoint = findSplitPoint(text, limit, platform);

  if (splitPoint <= 0) {
    // Can't split safely — force split at limit
    log.warn(`[${platform.name}] Forced split at character limit`);
    const firstPart = truncateToLength(text, limit, platform);
    const rest = text.slice(firstPart.length).trim();
    if (!rest) return [firstPart];
    return [firstPart, ...splitAtBoundary(rest, limit, platform)];
  }

  const firstPart = text.slice(0, splitPoint).trim();
  const rest = text.slice(splitPoint).trim();

  if (!rest) return [firstPart];
  return [firstPart, ...splitAtBoundary(rest, limit, platform)];
}

/**
 * Find the best split point within the character limit.
 * Precedence: paragraph break > sentence end > space
 *
 * @param {string} text
 * @param {number} limit
 * @param {PlatformConfig} platform
 * @returns {number} Character index to split at (-1 if no safe split found)
 */
function findSplitPoint(text, limit, platform) {
  // Get the substring that fits within the limit
  const window = getSubstringWithinLimit(text, limit, platform);

  // 1. Try paragraph break (\n\n)
  const paraBreak = window.lastIndexOf('\n\n');
  if (paraBreak > 0) return paraBreak;

  // 2. Try sentence end (. or ? or ! followed by space or end)
  const sentenceEnd = findLastSentenceEnd(window);
  if (sentenceEnd > 0) return sentenceEnd;

  // 3. Try space
  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace > 0) return lastSpace;

  return -1;
}

/**
 * Find the last sentence-ending position in text.
 * Looks for `. `, `? `, `! ` or end-of-string variants.
 * @param {string} text
 * @returns {number} Position after the punctuation, or -1
 */
function findLastSentenceEnd(text) {
  let best = -1;
  const patterns = ['. ', '? ', '! '];

  for (const pat of patterns) {
    const idx = text.lastIndexOf(pat);
    if (idx > best) {
      best = idx + pat.length - 1; // Include the punctuation, split before the space
    }
  }

  // Also check for sentence ending at end of string
  if (text.endsWith('.') || text.endsWith('?') || text.endsWith('!')) {
    if (text.length > best) {
      best = text.length;
    }
  }

  return best;
}

/**
 * Get substring of text that fits within the character limit.
 * Accounts for different count modes (char vs grapheme).
 * @param {string} text
 * @param {number} limit
 * @param {PlatformConfig} platform
 * @returns {string}
 */
function getSubstringWithinLimit(text, limit, platform) {
  if (platform.countMode === 'grapheme') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = [...segmenter.segment(text)];
    const limited = segments.slice(0, limit);
    return limited.map(s => s.segment).join('');
  }
  // For char mode (Mastodon), simple slice works as an approximation.
  // URL adjustment means actual display might differ, but for finding
  // split points this is close enough.
  return text.slice(0, limit);
}

/**
 * Truncate text to fit within the character limit.
 * @param {string} text
 * @param {number} limit
 * @param {PlatformConfig} platform
 * @returns {string}
 */
function truncateToLength(text, limit, platform) {
  return getSubstringWithinLimit(text, limit, platform);
}

/**
 * Distribute images across split text parts using the proximity rule.
 * Images are attached to the part that contains their original position,
 * or the nearest part if the exact position doesn't exist after splitting.
 *
 * @param {string[]} textParts
 * @param {string} originalText
 * @param {Array<{alt: string, path: string}>} images
 * @param {PlatformConfig} platform
 * @returns {Array<{text: string, images: Array<{alt: string, path: string}>}>}
 */
function distributeImages(textParts, originalText, images, platform) {
  if (images.length === 0) {
    return textParts.map(text => ({ text, images: [] }));
  }

  // Find image positions in the original (unstripped) text
  const imagePositions = [];
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = imgRegex.exec(originalText)) !== null) {
    imagePositions.push({
      alt: match[1],
      path: match[2],
      position: match.index / originalText.length, // Normalized position (0-1)
    });
  }

  // If no image markdown was found in the original text (shouldn't happen,
  // but fallback), assign all images to the last part.
  if (imagePositions.length === 0) {
    const result = textParts.map(text => ({ text, images: [] }));
    result[result.length - 1].images = images;
    return result;
  }

  // Map each part to its proportional range in the stripped text
  const totalLen = textParts.reduce((sum, p) => sum + p.length, 0);
  let cumulative = 0;
  const partRanges = textParts.map(part => {
    const start = cumulative / totalLen;
    cumulative += part.length;
    const end = cumulative / totalLen;
    return { start, end };
  });

  // Assign each image to the closest part
  const result = textParts.map(text => ({ text, images: [] }));

  for (const img of imagePositions) {
    let bestPart = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < partRanges.length; i++) {
      const mid = (partRanges[i].start + partRanges[i].end) / 2;
      const dist = Math.abs(img.position - mid);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestPart = i;
      }
    }

    result[bestPart].images.push({ alt: img.alt, path: img.path });
  }

  return result;
}
