import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';

/**
 * Detect the available ImageMagick command.
 * ImageMagick 7 uses `magick`, legacy v6 uses `convert`.
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
function findFiles(dir, extensions) {
  const results = [];
  if (!existsSync(dir)) return results;

  const list = readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      results.push(...findFiles(filePath, extensions));
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
    console.warn('[webp-converter] ⚠ ImageMagick not found. Skipping WebP conversion.');
    return;
  }
  console.log(`[webp-converter] Using ImageMagick command: ${magickCmd}`);

  const screenshotsDir = resolve('content/recs/screenshots');
  const images = findFiles(screenshotsDir, ['png', 'jpg', 'jpeg']);

  console.log(`[webp-converter] Found ${images.length} images to process.`);

  const replacements = [];
  let originalSizeTotal = 0;
  let webpSizeTotal = 0;

  for (const imagePath of images) {
    const ext = extname(imagePath);
    if (ext.toLowerCase() === '.webp') continue;

    const baseName = basename(imagePath);
    const newBaseName = baseName.slice(0, -ext.length) + '.webp';
    const newImagePath = join(screenshotsDir, newBaseName);

    try {
      const sizeBefore = statSync(imagePath).size;
      originalSizeTotal += sizeBefore;

      console.log(`[webp-converter] Converting: ${baseName} -> ${newBaseName}`);
      execFileSync(magickCmd, [
        imagePath,
        '-resize', '1200x1200>',
        '-strip',
        '-quality', '82',
        newImagePath
      ]);

      if (existsSync(newImagePath)) {
        const sizeAfter = statSync(newImagePath).size;
        webpSizeTotal += sizeAfter;

        const reduction = sizeBefore > 0 ? ((sizeBefore - sizeAfter) / sizeBefore * 100).toFixed(1) : 0;
        console.log(`                 ${(sizeBefore / 1024 / 1024).toFixed(2)}MB -> ${(sizeAfter / 1024).toFixed(1)}KB (${reduction}% smaller)`);

        // Clean up original file
        unlinkSync(imagePath);
        replacements.push({
          oldName: baseName,
          newName: newBaseName
        });
      }
    } catch (err) {
      console.error(`[webp-converter] ✖ Failed to convert ${baseName}:`, err.message);
    }
  }

  if (replacements.length === 0) {
    console.log('[webp-converter] No files were converted.');
    return;
  }

  console.log(`\n[webp-converter] Converted ${replacements.length} files. Updating markdown files...`);

  // Find all markdown files in content/ and root README.md
  const mdFiles = findFiles(resolve('content'), ['md']).concat(findFiles(resolve('.'), ['md']));

  for (const mdPath of mdFiles) {
    try {
      let content = readFileSync(mdPath, 'utf-8');
      let modified = false;

      for (const { oldName, newName } of replacements) {
        if (content.includes(oldName)) {
          content = content.replaceAll(oldName, newName);
          modified = true;
        }
      }

      if (modified) {
        writeFileSync(mdPath, content, 'utf-8');
        console.log(`[webp-converter] Updated: ${basename(mdPath)}`);
      }
    } catch (err) {
      console.error(`[webp-converter] ✖ Failed to update ${basename(mdPath)}:`, err.message);
    }
  }

  const savedMB = ((originalSizeTotal - webpSizeTotal) / 1024 / 1024).toFixed(2);
  console.log(`\n[webp-converter] Complete! Total space saved: ${savedMB} MB`);
}

main();
