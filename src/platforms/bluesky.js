/**
 * BlueSky AT Protocol Client — posts records and uploads blobs.
 *
 * Uses the AT Protocol XRPC API directly via fetch (no dependencies).
 * Threading is done via reply references (root + parent).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mimeFromPath, generateBskyFacets, createLogger } from '../utils.js';
import { prepareImage } from '../images.js';

const log = createLogger('bluesky');

/** Default BlueSky PDS (Personal Data Server). */
const DEFAULT_PDS = 'https://bsky.social';

/**
 * @typedef {Object} BlueskyConfig
 * @property {string} handle - BlueSky handle (e.g. user.bsky.social)
 * @property {string} appPassword - App password for authentication
 * @property {string} [pds] - PDS URL (defaults to bsky.social)
 */

/**
 * Create a BlueSky client.
 * @param {BlueskyConfig} config
 */
export function createBlueskyClient(config) {
  const { handle, appPassword, pds = DEFAULT_PDS } = config;
  const baseUrl = pds.replace(/\/+$/, '');

  let session = null; // { did, accessJwt, refreshJwt }

  /**
   * Authenticate and create a session.
   * @returns {Promise<void>}
   */
  async function authenticate() {
    log.info(`Authenticating as ${handle}...`);
    const response = await fetch(`${baseUrl}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: handle,
        password: appPassword,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`BlueSky auth failed ${response.status}: ${body}`);
    }

    session = await response.json();
    log.info(`  Authenticated as ${session.did}`);
  }

  /**
   * Make an authenticated XRPC request.
   * @param {string} method - XRPC method name
   * @param {Object} [options]
   * @param {Object} [options.body] - Request body (will be JSON-serialized unless rawBody is set)
   * @param {Buffer|Uint8Array} [options.rawBody] - Raw binary body (for blob uploads)
   * @param {string} [options.contentType] - Content-Type for raw body
   * @returns {Promise<Object>} Parsed JSON response
   */
  async function xrpc(method, options = {}) {
    if (!session) await authenticate();

    const url = `${baseUrl}/xrpc/${method}`;
    const headers = {
      Authorization: `Bearer ${session.accessJwt}`,
    };

    let body;
    if (options.rawBody) {
      headers['Content-Type'] = options.contentType || 'application/octet-stream';
      body = options.rawBody;
    } else if (options.body) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`BlueSky XRPC ${method} failed ${response.status}: ${errorBody}`);
    }

    return response.json();
  }

  /**
   * Upload a blob (image/media) to BlueSky.
   *
   * @param {string} filePath - Path to the file (relative to repo root)
   * @param {string} [repoRoot] - Repository root for resolving paths
   * @returns {Promise<Object>} The blob reference object
   */
  async function uploadBlob(filePath, repoRoot = process.cwd()) {
    const absolutePath = resolve(repoRoot, filePath);

    // Optimize image if it exceeds BlueSky's 1MB limit
    const { buffer, mime } = prepareImage(absolutePath);

    log.info(`Uploading blob: ${filePath} (${mime}, ${(buffer.byteLength / 1024).toFixed(0)}KB)`);
    const result = await xrpc('com.atproto.repo.uploadBlob', {
      rawBody: buffer,
      contentType: mime,
    });

    log.info(`  Blob uploaded`);
    return result.blob;
  }

  /**
   * Create a post record on BlueSky.
   *
   * @param {Object} params
   * @param {string} params.text - The post text
   * @param {Array<{alt: string, blob: Object}>} [params.images] - Image embeds
   * @param {Object} [params.reply] - Reply reference { root: {uri, cid}, parent: {uri, cid} }
   * @returns {Promise<{uri: string, cid: string}>}
   */
  async function createPost({ text, images = [], reply = null }) {
    const record = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
    };

    // Generate facets for URLs and hashtags
    const facets = generateBskyFacets(text);
    if (facets.length > 0) {
      record.facets = facets;
    }

    // Add image embeds
    if (images.length > 0) {
      record.embed = {
        $type: 'app.bsky.embed.images',
        images: images.map(img => ({
          alt: img.alt || '',
          image: img.blob,
        })),
      };
    }

    // Add reply reference
    if (reply) {
      record.reply = reply;
    }

    log.info(`Creating post (${text.length} chars, ${images.length} images)${reply ? ' [reply]' : ''}`);
    const result = await xrpc('com.atproto.repo.createRecord', {
      body: {
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      },
    });

    log.info(`  Posted: ${result.uri}`);
    return { uri: result.uri, cid: result.cid };
  }

  /**
   * Post a full thread.
   * Threading uses reply references: root stays the first post,
   * parent is the immediately preceding post.
   *
   * @param {Array<{text: string, images: Array<{alt: string, path: string}>}>} posts
   * @param {string} [repoRoot]
   * @returns {Promise<Array<{uri: string, cid: string}>>}
   */
  async function postThread(posts, repoRoot = process.cwd()) {
    // Ensure authenticated before starting
    if (!session) await authenticate();

    const results = [];
    let rootRef = null;
    let parentRef = null;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];

      // Upload images for this post
      const imageEmbeds = [];
      for (const img of post.images) {
        try {
          const blob = await uploadBlob(img.path, repoRoot);
          imageEmbeds.push({ alt: img.alt, blob });
        } catch (err) {
          log.error(`Failed to upload ${img.path}:`, err.message);
          // Continue without the image
        }
      }

      // Build reply reference
      let reply = null;
      if (parentRef) {
        reply = {
          root: rootRef,
          parent: parentRef,
        };
      }

      // Create the post
      const result = await createPost({
        text: post.text,
        images: imageEmbeds,
        reply,
      });

      results.push(result);

      // Update references for threading
      if (!rootRef) {
        rootRef = { uri: result.uri, cid: result.cid };
      }
      parentRef = { uri: result.uri, cid: result.cid };

      // Small delay between posts
      if (i < posts.length - 1) {
        await sleep(500);
      }
    }

    return results;
  }

  return { authenticate, uploadBlob, createPost, postThread };
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
