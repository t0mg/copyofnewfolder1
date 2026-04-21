/**
 * Mastodon API Client — posts statuses and uploads media.
 *
 * Uses the Mastodon REST API directly via fetch (no dependencies).
 * Threading is done by chaining posts via in_reply_to_id.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mimeFromPath, createLogger } from '../utils.js';

const log = createLogger('mastodon');

/**
 * @typedef {Object} MastodonConfig
 * @property {string} instanceUrl - The Mastodon instance URL (e.g. https://mastodon.social)
 * @property {string} accessToken - The access token for the Mastodon API
 */

/**
 * Create a Mastodon client.
 * @param {MastodonConfig} config
 */
export function createMastodonClient(config) {
  const { instanceUrl, accessToken } = config;
  const baseUrl = instanceUrl.replace(/\/+$/, '');

  /**
   * Make an authenticated API request.
   * @param {string} endpoint
   * @param {RequestInit} options
   * @returns {Promise<Response>}
   */
  async function apiRequest(endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Mastodon API error ${response.status}: ${body}`);
    }

    return response;
  }

  /**
   * Upload a media file to Mastodon.
   * Uses the v2 async media endpoint.
   *
   * @param {string} filePath - Path to the media file (relative to repo root)
   * @param {string} altText - Alt text for accessibility
   * @param {string} [repoRoot] - Repository root path for resolving relative paths
   * @returns {Promise<string>} The media attachment ID
   */
  async function uploadMedia(filePath, altText, repoRoot = process.cwd()) {
    const absolutePath = resolve(repoRoot, filePath);
    const fileBuffer = readFileSync(absolutePath);
    const mime = mimeFromPath(filePath);
    const fileName = filePath.split('/').pop();

    // Build multipart form data manually using Blob API
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer], { type: mime }), fileName);
    if (altText) {
      formData.append('description', altText);
    }

    log.info(`Uploading media: ${filePath}`);
    const response = await apiRequest('/api/v2/media', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    const mediaId = data.id;

    // If async processing (202), poll until ready
    if (response.status === 202 || !data.url) {
      log.info(`  Media processing async, polling...`);
      await pollMediaReady(mediaId);
    }

    log.info(`  Media uploaded: ${mediaId}`);
    return mediaId;
  }

  /**
   * Poll the media endpoint until processing is complete.
   * @param {string} mediaId
   * @param {number} maxAttempts
   * @param {number} intervalMs
   */
  async function pollMediaReady(mediaId, maxAttempts = 30, intervalMs = 2000) {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(intervalMs);
      const response = await apiRequest(`/api/v1/media/${mediaId}`);
      const data = await response.json();
      if (data.url) return;
    }
    log.warn(`Media ${mediaId} processing timed out, proceeding anyway`);
  }

  /**
   * Post a status (with optional media and reply chain).
   *
   * @param {Object} params
   * @param {string} params.text - The status text
   * @param {string[]} [params.mediaIds] - Array of media attachment IDs
   * @param {string} [params.inReplyToId] - ID of status to reply to (for threading)
   * @param {string} [params.visibility] - Post visibility (public, unlisted, private, direct)
   * @returns {Promise<{id: string, uri: string}>}
   */
  async function postStatus({ text, mediaIds = [], inReplyToId = null, visibility = 'public' }) {
    const body = {
      status: text,
      visibility,
    };

    if (mediaIds.length > 0) {
      body.media_ids = mediaIds;
    }

    if (inReplyToId) {
      body.in_reply_to_id = inReplyToId;
    }

    log.info(`Posting status (${text.length} chars, ${mediaIds.length} media)${inReplyToId ? ' [reply]' : ''}`);
    const response = await apiRequest('/api/v1/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    log.info(`  Posted: ${data.url || data.uri}`);
    return { id: data.id, uri: data.uri };
  }

  /**
   * Post a full thread of content.
   * First post is public; subsequent posts are unlisted.
   *
   * @param {Array<{text: string, images: Array<{alt: string, path: string}>}>} posts
   * @param {string} [repoRoot]
   * @returns {Promise<Array<{id: string, uri: string}>>}
   */
  async function postThread(posts, repoRoot = process.cwd()) {
    const results = [];
    let previousId = null;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const isFirst = i === 0;

      // Upload images for this post
      const mediaIds = [];
      for (const img of post.images) {
        try {
          const mediaId = await uploadMedia(img.path, img.alt, repoRoot);
          mediaIds.push(mediaId);
        } catch (err) {
          log.error(`Failed to upload ${img.path}:`, err.message);
          // Continue without the image rather than failing the whole thread
        }
      }

      // Post the status
      const result = await postStatus({
        text: post.text,
        mediaIds,
        inReplyToId: previousId,
        visibility: isFirst ? 'public' : 'unlisted',
      });

      results.push(result);
      previousId = result.id;

      // Small delay between posts to be respectful to the API
      if (i < posts.length - 1) {
        await sleep(1000);
      }
    }

    return results;
  }

  return { uploadMedia, postStatus, postThread };
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
