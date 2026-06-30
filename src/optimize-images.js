import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Detect the available ImageMagick command.
 * ImageMagick 7 uses `magick`, legacy v6 uses `convert`.
 * It avoids using Windows native 'convert' utility by checking the stdout for 'ImageMagick'.
 */
function detectMagickCommand() {
  for (const cmd of ['magick', 'convert']) {
    try {
      const stdout = execFileSync(cmd, ['-version'], { stdio: 'pipe' }).toString();
      if (stdout.includes('ImageMagick')) {
        return cmd;
      }
    } catch {}
  }
  return null;
}

/**
 * Recursively find all files with specified extensions in a directory.
 */
function findImages(dir, extensions) {
  const results = [];
  if (!existsSync(dir)) return results;

  const list = readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      results.push(...findImages(filePath, extensions));
    } else {
      const ext = filePath.split('.').pop()?.toLowerCase();
      if (ext && extensions.includes(ext)) {
        results.push(filePath);
      }
    }
  }
  return results;
}

function main() {
  const magickCmd = detectMagickCommand();
  if (!magickCmd) {
    console.warn('[images-optimizer] ⚠ ImageMagick not found. Skipping image optimization.');
    return;
  }
  console.log(`[images-optimizer] Using ImageMagick command: ${magickCmd}`);

  const screenshotsDir = resolve('content/recs/screenshots');
  const imageExtensions = ['png', 'jpg', 'jpeg'];
  const images = findImages(screenshotsDir, imageExtensions);

  console.log(`[images-optimizer] Found ${images.length} images to check.`);

  let totalOriginalSize = 0;
  let totalOptimizedSize = 0;

  for (const imagePath of images) {
    try {
      const statsBefore = statSync(imagePath);
      const sizeBefore = statsBefore.size;
      totalOriginalSize += sizeBefore;

      // Optimize image in-place
      // -resize 1200x1200> : resizes only if larger than 1200px
      // -strip : removes EXIF profiles and metadata
      // -quality 85 : sets compression quality (good balance for PNG and JPEG)
      execFileSync(magickCmd, [
        imagePath,
        '-resize', '1200x1200>',
        '-strip',
        '-quality', '85',
        imagePath
      ]);

      const statsAfter = statSync(imagePath);
      const sizeAfter = statsAfter.size;
      totalOptimizedSize += sizeAfter;

      const reduction = sizeBefore > 0 ? ((sizeBefore - sizeAfter) / sizeBefore * 100).toFixed(1) : 0;
      const mbBefore = (sizeBefore / 1024 / 1024).toFixed(2);
      const kbAfter = (sizeAfter / 1024).toFixed(1);

      console.log(`[images-optimizer] Optimized: ${join('screenshots', imagePath.split('screenshots').pop())}`);
      console.log(`                   ${mbBefore}MB -> ${kbAfter}KB (${reduction}% smaller)`);
    } catch (err) {
      console.error(`[images-optimizer] ✖ Failed to optimize ${imagePath}:`, err.message);
    }
  }

  const savedMB = ((totalOriginalSize - totalOptimizedSize) / 1024 / 1024).toFixed(2);
  console.log(`\n[images-optimizer] Complete! Total space saved on Pages deploy: ${savedMB} MB`);
}

main();
