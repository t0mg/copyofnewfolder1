/**
 * Yodelog — Main Orchestrator
 *
 * Entry point for the GitHub Actions pipeline.
 * Coordinates: env validation → diff → parse → split → broadcast.
 *
 * Supports:
 * - Dry-run mode via `.dryrun.md` file suffix
 * - Auto dry-run when no API keys are configured
 * - Full broadcasting to Mastodon and BlueSky
 */

import { readFileSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';
import { getNewPosts } from './diff.js';
import { readFrontmatter, processBlock, parseScheduleTag } from './parser.js';
import { splitForPlatform, MASTODON_CONFIG, BLUESKY_CONFIG } from './splitter.js';
import { createMastodonClient } from './platforms/mastodon.js';
import { createBlueskyClient } from './platforms/bluesky.js';
import { getWatermarkTime, updateWatermark, getScheduledPosts } from './schedule.js';
import { createLogger } from './utils.js';

const log = createLogger('main');

/** Broadcasting mode: 'instant' (push-triggered) or 'cron' (scheduled). */
const YODELOG_MODE = process.env.YODELOG_MODE || 'instant';

// ---------------------------------------------------------------------------
// Environment & Configuration
// ---------------------------------------------------------------------------

/**
 * Check which platforms have valid credentials configured.
 * @returns {{ mastodon: boolean, bluesky: boolean, mastodonConfig: Object|null, blueskyConfig: Object|null }}
 */
function checkCredentials() {
  const mastodonToken = process.env.MASTODON_ACCESS_TOKEN;
  const mastodonUrl = process.env.MASTODON_INSTANCE_URL;
  const blueskyHandle = process.env.BLUESKY_HANDLE;
  const blueskyPassword = process.env.BLUESKY_APP_PASSWORD;

  return {
    mastodon: !!(mastodonToken && mastodonUrl),
    bluesky: !!(blueskyHandle && blueskyPassword),
    mastodonConfig: mastodonToken && mastodonUrl
      ? { instanceUrl: mastodonUrl, accessToken: mastodonToken }
      : null,
    blueskyConfig: blueskyHandle && blueskyPassword
      ? { handle: blueskyHandle, appPassword: blueskyPassword }
      : null,
  };
}

/**
 * Read the GitHub Actions event payload to get before/after SHAs.
 * Falls back to environment variables if the event file is unavailable.
 * @returns {{ before: string, after: string }}
 */
function getCommitRange() {
  // Try environment variables first (set in workflow)
  const envBefore = process.env.GITHUB_EVENT_BEFORE;
  const envAfter = process.env.GITHUB_EVENT_AFTER;
  if (envBefore && envAfter) {
    return { before: envBefore, after: envAfter };
  }

  // Try GitHub event payload file
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const event = JSON.parse(readFileSync(eventPath, 'utf-8'));
      return {
        before: event.before || '',
        after: event.after || 'HEAD',
      };
    } catch {
      // Fall through
    }
  }

  // Fallback for local testing
  log.warn('No commit range found, using HEAD~1..HEAD');
  return { before: 'HEAD~1', after: 'HEAD' };
}

// ---------------------------------------------------------------------------
// Dry Run
// ---------------------------------------------------------------------------

/**
 * Log a simulated post for dry-run mode.
 * @param {string} platform
 * @param {number} index
 * @param {number} total
 * @param {{text: string, images: Array<{alt: string, path: string}>}} post
 */
function logDryRunPost(platform, index, total, post) {
  const threadLabel = total > 1 ? ` [${index + 1}/${total}]` : '';
  console.log(`\n  ┌─ ${platform}${threadLabel}`);
  console.log(`  │ ${post.text.replace(/\n/g, '\n  │ ')}`);
  if (post.images.length > 0) {
    for (const img of post.images) {
      console.log(`  │ 📎 ${img.path}${img.alt ? ` (${img.alt})` : ''}`);
    }
  }
  console.log(`  └─ (${post.text.length} chars)`);
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

async function main() {
  const modeLabel = YODELOG_MODE === 'cron' ? 'Scheduled' : 'Instant';
  console.log(`\n🔊 Yodelog — ${modeLabel} Broadcast Pipeline\n`);

  // 1. Check credentials
  const creds = checkCredentials();
  const hasAnyCreds = creds.mastodon || creds.bluesky;

  if (creds.mastodon) log.info('✓ Mastodon credentials found');
  else log.warn('✗ Mastodon credentials not configured');

  if (creds.bluesky) log.info('✓ BlueSky credentials found');
  else log.warn('✗ BlueSky credentials not configured');

  if (!hasAnyCreds) {
    log.warn('\nNo platform credentials configured.');
    log.warn('All posts will be logged in dry-run mode.');
    log.warn('To configure, add secrets to your GitHub repository:');
    log.warn('  • MASTODON_ACCESS_TOKEN + MASTODON_INSTANCE_URL');
    log.warn('  • BLUESKY_HANDLE + BLUESKY_APP_PASSWORD\n');
  }

  // Branch by mode
  if (YODELOG_MODE === 'cron') {
    await runCronMode(creds, hasAnyCreds);
  } else {
    await runInstantMode(creds, hasAnyCreds);
  }
}

// ---------------------------------------------------------------------------
// Instant Mode (push-triggered, existing behavior)
// ---------------------------------------------------------------------------

async function runInstantMode(creds, hasAnyCreds) {
  // 2. Get commit range
  const { before, after } = getCommitRange();
  log.info(`Commit range: ${before.slice(0, 8)}..${after.slice(0, 8)}`);

  // 3. Extract new posts from diff
  const fileResults = getNewPosts(before, after);

  if (fileResults.length === 0) {
    log.info('No new posts found. Nothing to broadcast.');
    return;
  }

  // 4. Process each file
  let totalPosts = 0;
  let totalBroadcast = 0;

  for (const { file, blocks } of fileResults) {
    log.info(`\n📄 Processing: ${file}`);

    // Check if this is a dry-run file
    const isDryRunFile = basename(file).includes('.dryrun.');

    // Read frontmatter from the full file
    const frontmatter = readFrontmatter(file);

    if (!frontmatter.yodelog) {
      log.info(`  Skipping: yodelog flag not set`);
      continue;
    }

    // Skip schedule-only files in push/instant mode
    if (frontmatter.post_on === 'schedule') {
      log.info(`  Skipping: file is in schedule-only mode`);
      continue;
    }

    const options = {
      prefix: frontmatter.prefix,
      suffix: frontmatter.suffix,
      thread_style: frontmatter.thread_style,
    };

    // Process each block (each `## ` heading is a separate post/thread)
    for (const block of blocks) {
      // In instant mode, skip posts with a {time: ...} tag — defer to cron
      const { scheduledTime } = parseScheduleTag(block.heading);
      if (scheduledTime) {
        log.info(`  ⏭ Skipping scheduled post: "${block.heading}" (deferred to cron)`);
        continue;
      }

      totalPosts++;
      const processed = processBlock(block);
      const headingPreview = processed.heading || '(no heading)';
      log.info(`\n  📝 Post: "${headingPreview}" (${processed.chunks.length} chunk(s))`);

      // Determine mode for this post
      const isDryRun = isDryRunFile || !hasAnyCreds;

      if (isDryRun) {
        const reason = isDryRunFile ? 'dry-run file' : 'no credentials';
        console.log(`\n  🔍 DRY RUN (${reason}) — would broadcast:`);
      }

      // Split and broadcast for each platform
      const platforms = [
        { config: MASTODON_CONFIG, name: 'Mastodon', enabled: creds.mastodon, clientConfig: creds.mastodonConfig },
        { config: BLUESKY_CONFIG, name: 'BlueSky', enabled: creds.bluesky, clientConfig: creds.blueskyConfig },
      ];

      // Resolve image paths relative to the markdown file's directory
      const fileDir = dirname(file);
      for (const chunk of processed.chunks) {
        for (const img of chunk.images) {
          img.path = join(fileDir, img.path);
        }
      }

      for (const platform of platforms) {
        const posts = splitForPlatform(processed.chunks, platform.config, options);

        if (isDryRun) {
          // Dry-run: log what would be posted
          for (let i = 0; i < posts.length; i++) {
            logDryRunPost(platform.name, i, posts.length, posts[i]);
          }
          continue;
        }

        if (!platform.enabled) continue;

        // Live broadcast
        try {
          if (platform.config.name === 'mastodon') {
            const client = createMastodonClient(platform.clientConfig);
            await client.postThread(posts);
            totalBroadcast++;
          } else if (platform.config.name === 'bluesky') {
            const client = createBlueskyClient(platform.clientConfig);
            await client.postThread(posts);
            totalBroadcast++;
          }
        } catch (err) {
          log.error(`Failed to broadcast to ${platform.name}:`, err.message);
        }
      }
    }
  }

  // 5. Summary
  writeSummary(totalPosts, totalBroadcast, creds, 'instant');
}

// ---------------------------------------------------------------------------
// Cron Mode (scheduled broadcasts)
// ---------------------------------------------------------------------------

async function runCronMode(creds, hasAnyCreds) {
  const now = new Date();
  const watermark = getWatermarkTime();

  log.info(`Mode: cron`);
  log.info(`Now:       ${now.toISOString()}`);
  log.info(`Watermark: ${watermark.toISOString()}`);
  log.info(`Window:    ${watermark.toISOString()} → ${now.toISOString()}`);

  const fileResults = getScheduledPosts(watermark, now);

  if (fileResults.length === 0) {
    log.info('No scheduled posts ready. Nothing to broadcast.');
    // Still update watermark to avoid re-scanning the same window
    try {
      updateWatermark(now);
    } catch {
      // Non-critical on empty run
    }
    return;
  }

  let totalPosts = 0;
  let totalBroadcast = 0;

  for (const { file, blocks, frontmatter } of fileResults) {
    log.info(`\n📄 Processing: ${file}`);

    const isDryRunFile = basename(file).includes('.dryrun.');

    const options = {
      prefix: frontmatter.prefix,
      suffix: frontmatter.suffix,
      thread_style: frontmatter.thread_style,
    };

    for (const block of blocks) {
      totalPosts++;

      // The heading was already cleaned by schedule.js (schedule tag stripped)
      const processed = processBlock(block);
      const headingPreview = processed.heading || '(no heading)';
      log.info(`\n  📝 Scheduled Post: "${headingPreview}" (${processed.chunks.length} chunk(s))`);

      const isDryRun = isDryRunFile || !hasAnyCreds;

      if (isDryRun) {
        const reason = isDryRunFile ? 'dry-run file' : 'no credentials';
        console.log(`\n  🔍 DRY RUN (${reason}) — would broadcast:`);
      }

      const platforms = [
        { config: MASTODON_CONFIG, name: 'Mastodon', enabled: creds.mastodon, clientConfig: creds.mastodonConfig },
        { config: BLUESKY_CONFIG, name: 'BlueSky', enabled: creds.bluesky, clientConfig: creds.blueskyConfig },
      ];

      // Resolve image paths relative to the markdown file's directory
      const fileDir = dirname(file);
      for (const chunk of processed.chunks) {
        for (const img of chunk.images) {
          img.path = join(fileDir, img.path);
        }
      }

      for (const platform of platforms) {
        const posts = splitForPlatform(processed.chunks, platform.config, options);

        if (isDryRun) {
          for (let i = 0; i < posts.length; i++) {
            logDryRunPost(platform.name, i, posts.length, posts[i]);
          }
          continue;
        }

        if (!platform.enabled) continue;

        try {
          if (platform.config.name === 'mastodon') {
            const client = createMastodonClient(platform.clientConfig);
            await client.postThread(posts);
            totalBroadcast++;
          } else if (platform.config.name === 'bluesky') {
            const client = createBlueskyClient(platform.clientConfig);
            await client.postThread(posts);
            totalBroadcast++;
          }
        } catch (err) {
          log.error(`Failed to broadcast to ${platform.name}:`, err.message);
        }
      }
    }
  }

  // Update watermark after processing
  try {
    updateWatermark(now);
  } catch (err) {
    log.error('Failed to update watermark — posts may be re-broadcast on next run');
  }

  // Summary
  writeSummary(totalPosts, totalBroadcast, creds, 'cron');
}

// ---------------------------------------------------------------------------
// Shared: Summary output
// ---------------------------------------------------------------------------

async function writeSummary(totalPosts, totalBroadcast, creds, mode) {
  console.log('\n' + '─'.repeat(50));
  log.info(`Done! Processed ${totalPosts} post(s), broadcast ${totalBroadcast} time(s).`);

  // Write GitHub Actions job summary if available
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    const modeLabel = mode === 'cron' ? '⏰ Scheduled' : '⚡ Instant';
    const summary = [
      `## 🔊 Yodelog Broadcast Summary (${modeLabel})`,
      '',
      `| Metric | Count |`,
      `|--------|-------|`,
      `| Posts found | ${totalPosts} |`,
      `| Broadcasts sent | ${totalBroadcast} |`,
      `| Mastodon | ${creds.mastodon ? '✅ configured' : '❌ not configured'} |`,
      `| BlueSky | ${creds.bluesky ? '✅ configured' : '❌ not configured'} |`,
    ].join('\n');

    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    } catch {
      // Not critical
    }
  }
}

// Run
main().catch(err => {
  log.error('Fatal error:', err);
  process.exit(1);
});
