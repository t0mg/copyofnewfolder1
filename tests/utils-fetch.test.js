import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchUrlMetadata } from '../src/utils.js';

describe('fetchUrlMetadata', () => {
  it('should extract basic og tags', async () => {
    // We will override global fetch to mock responses
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return {
        ok: true,
        text: async () => `<html>
          <head>
            <meta property="og:title" content="Mock Title">
            <meta property="og:description" content="Mock Desc">
            <meta property="og:image" content="https://example.com/img.jpg">
          </head>
        </html>`
      };
    };

    const meta = await fetchUrlMetadata('https://example.com');
    assert.equal(meta.title, 'Mock Title');
    assert.equal(meta.description, 'Mock Desc');
    assert.equal(meta.image, 'https://example.com/img.jpg');

    global.fetch = originalFetch;
  });

  it('should decode HTML entities', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return {
        ok: true,
        text: async () => `<html>
          <head>
            <meta property="og:title" content="Me &amp; You">
            <meta property="og:description" content="&quot;Quote&quot; test">
          </head>
        </html>`
      };
    };

    const meta = await fetchUrlMetadata('https://example.com');
    assert.equal(meta.title, 'Me & You');
    assert.equal(meta.description, '"Quote" test');

    global.fetch = originalFetch;
  });

  it('should handle relative image URLs', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return {
        ok: true,
        text: async () => `<html>
          <head>
            <meta property="og:title" content="Title">
            <meta property="og:image" content="/local/img.png">
          </head>
        </html>`
      };
    };

    const meta = await fetchUrlMetadata('https://example.com/path');
    assert.equal(meta.image, 'https://example.com/local/img.png');

    global.fetch = originalFetch;
  });

  it('should extract title tag and name=description if og tags missing', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return {
        ok: true,
        text: async () => `<html>
          <head>
            <title>
                Some Title
            </title>
            <meta name="description" content="Some description">
          </head>
        </html>`
      };
    };

    const meta = await fetchUrlMetadata('https://example.com/path');
    assert.equal(meta.title, 'Some Title');
    assert.equal(meta.description, 'Some description');

    global.fetch = originalFetch;
  });

  it('should return null if no title and description', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      return {
        ok: true,
        text: async () => `<html>
          <head>
            <meta name="robots" content="noindex">
          </head>
        </html>`
      };
    };

    const meta = await fetchUrlMetadata('https://example.com/path');
    assert.equal(meta, null);

    global.fetch = originalFetch;
  });
});
