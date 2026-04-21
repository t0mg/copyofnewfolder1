/**
 * Image Optimization — zero-dependency image resizing via system ImageMagick.
 *
 * Requires ImageMagick to be installed on the runner (added as a workflow step).
 * Supports both ImageMagick 7 (`magick`) and legacy ImageMagick 6 (`convert`).
 *
 * Falls back gracefully if ImageMagick is not available.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger, mimeFromPath } from './utils.js';

const log = createLogger('images');

/** Default maximum image size in bytes (BlueSky limit). */
const DEFAULT_MAX_BYTES = 1_000_000;

/**
 * Progressive optimization presets — tried in order until the image fits.
 * Each step reduces dimensions and/or quality.
 */
const OPTIMIZATION_STEPS = [
  { maxDim: 2048, quality: 85 },
  { maxDim: 1600, quality: 80 },
  { maxDim: 1200, quality: 75 },
  { maxDim: 1000, quality: 70 },
  { maxDim: 800,  quality: 60 },
];

/**
 * Detect the available ImageMagick command.
 * ImageMagick 7 uses `magick`, legacy v6 uses `convert`.
 * @returns {string|null} The command name, or null if not found
 */
function detectMagickCommand() {
  for (const cmd of ['magick', 'convert']) {
    try {
      execFileSync(cmd, ['-version'], { stdio: 'pipe' });
      return cmd;
    } catch {}
  }
  return null;
}

/** Cached ImageMagick command (detected once). */
let magickCmd = undefined;

/**
 * Get the ImageMagick command, detecting it on first call.
 * @returns {string|null}
 */
function getMagickCommand() {
  if (magickCmd === undefined) {
    magickCmd = detectMagickCommand();
    if (magickCmd) {
      log.info(`Using ImageMagick command: ${magickCmd}`);
    } else {
      log.warn('ImageMagick not found — image optimization disabled');
    }
  }
  return magickCmd;
}

/**
 * Prepare an image for upload, optimizing it if it exceeds the size limit.
 *
 * Strategy:
 * 1. If the image is already small enough, return it as-is.
 * 2. Otherwise, progressively resize and compress using ImageMagick
 *    until the output fits within the limit.
 * 3. Output is always JPEG for best compression ratio.
 *
 * @param {string} absolutePath - Absolute path to the image file
 * @param {number} [maxBytes] - Maximum file size in bytes
 * @returns {{ buffer: Buffer, mime: string, optimized: boolean }}
 */
export function prepareImage(absolutePath, maxBytes = DEFAULT_MAX_BYTES) {
  const original = readFileSync(absolutePath);
  const originalMime = mimeFromPath(absolutePath);

  if (original.byteLength <= maxBytes) {
    return { buffer: original, mime: originalMime, optimized: false };
  }

  const cmd = getMagickCommand();
  if (!cmd) {
    log.warn(`Image is ${(original.byteLength / 1024 / 1024).toFixed(1)}MB but ImageMagick is not available`);
    return { buffer: original, mime: originalMime, optimized: false };
  }

  const sizeMB = (original.byteLength / 1024 / 1024).toFixed(1);
  log.info(`Image is ${sizeMB}MB, optimizing to fit under ${(maxBytes / 1024 / 1024).toFixed(0)}MB...`);

  const tempDir = mkdtempSync(join(tmpdir(), 'yodelog-'));
  const tempOutput = join(tempDir, 'optimized.jpg');

  for (const { maxDim, quality } of OPTIMIZATION_STEPS) {
    try {
      execFileSync(cmd, [
        absolutePath,
        '-resize', `${maxDim}x${maxDim}>`, // Only shrink, never enlarge
        '-quality', String(quality),
        '-strip',                            // Remove EXIF and metadata
        `JPEG:${tempOutput}`,                // Force JPEG output format
      ], { stdio: 'pipe' });

      const result = readFileSync(tempOutput);

      if (result.byteLength <= maxBytes) {
        const sizeKB = (result.byteLength / 1024).toFixed(0);
        log.info(`  Optimized: ${sizeKB}KB (${maxDim}px max, q${quality})`);
        cleanup(tempOutput, tempDir);
        return { buffer: result, mime: 'image/jpeg', optimized: true };
      }
    } catch (err) {
      // ImageMagick not available or conversion failed
      log.warn(`  ImageMagick optimization failed: ${err.message}`);
      cleanup(tempOutput, tempDir);
      return { buffer: original, mime: originalMime, optimized: false };
    }
  }

  // All steps exhausted — return best effort (last attempt output)
  try {
    const lastAttempt = readFileSync(tempOutput);
    const sizeKB = (lastAttempt.byteLength / 1024).toFixed(0);
    log.warn(`  Best effort: ${sizeKB}KB (still over ${(maxBytes / 1024).toFixed(0)}KB limit)`);
    cleanup(tempOutput, tempDir);
    return { buffer: lastAttempt, mime: 'image/jpeg', optimized: true };
  } catch {
    cleanup(tempOutput, tempDir);
    return { buffer: original, mime: originalMime, optimized: false };
  }
}

/**
 * Clean up temporary files.
 * @param {string} file
 * @param {string} [dir]
 */
function cleanup(file, dir) {
  try { unlinkSync(file); } catch {}
  if (dir) {
    try { rmdirSync(dir); } catch {}
  }
}
