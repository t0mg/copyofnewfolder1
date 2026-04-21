import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitForPlatform, MASTODON_CONFIG, BLUESKY_CONFIG } from '../src/splitter.js';

const NO_OPTIONS = { prefix: '', suffix: '', thread_style: '' };

describe('splitForPlatform', () => {
  describe('single chunks that fit', () => {
    it('should return a single post when content fits Mastodon limit', () => {
      const chunks = [{ text: 'Hello world!', images: [] }];
      const result = splitForPlatform(chunks, MASTODON_CONFIG, NO_OPTIONS);
      assert.equal(result.length, 1);
      assert.equal(result[0].text, 'Hello world!');
    });

    it('should return a single post when content fits BlueSky limit', () => {
      const chunks = [{ text: 'Hello world!', images: [] }];
      const result = splitForPlatform(chunks, BLUESKY_CONFIG, NO_OPTIONS);
      assert.equal(result.length, 1);
      assert.equal(result[0].text, 'Hello world!');
    });
  });

  describe('auto-threading', () => {
    it('should split a long post at paragraph breaks for BlueSky', () => {
      const longText = 'A'.repeat(200) + '\n\n' + 'B'.repeat(200);
      const chunks = [{ text: longText, images: [] }];
      const result = splitForPlatform(chunks, BLUESKY_CONFIG, NO_OPTIONS);
      assert.ok(result.length >= 2, `Expected >=2 posts, got ${result.length}`);
      assert.ok(result[0].text.includes('A'));
      assert.ok(result[result.length - 1].text.includes('B'));
    });

    it('should split at sentence boundaries when no paragraph break', () => {
      // 350 chars with sentence breaks, no paragraph breaks
      const text = 'This is sentence one. ' +
        'This is sentence two that adds more length. ' +
        'This is sentence three with even more content to push past the limit. ' +
        'And here is sentence four. ' +
        'Sentence five continues. ' +
        'Sentence six goes on. ' +
        'Sentence seven wraps it up. ' +
        'Sentence eight is here. ' +
        'Sentence nine fills space. ' +
        'Sentence ten finishes.';
      const chunks = [{ text, images: [] }];
      const result = splitForPlatform(chunks, BLUESKY_CONFIG, NO_OPTIONS);
      assert.ok(result.length >= 2, `Expected >=2 posts, got ${result.length}`);
    });

    it('should not split content that fits within limit', () => {
      const text = 'Short post.';
      const chunks = [{ text, images: [] }];
      const result = splitForPlatform(chunks, BLUESKY_CONFIG, NO_OPTIONS);
      assert.equal(result.length, 1);
    });
  });

  describe('prefix, suffix, and thread_style', () => {
    it('should apply prefix to the first post', () => {
      const chunks = [{ text: 'Hello', images: [] }];
      const options = { prefix: '📝 ', suffix: '', thread_style: '' };
      const result = splitForPlatform(chunks, MASTODON_CONFIG, options);
      assert.equal(result[0].text, '📝 Hello');
    });

    it('should apply suffix to the last post', () => {
      const chunks = [{ text: 'Hello', images: [] }];
      const options = { prefix: '', suffix: '#test', thread_style: '' };
      const result = splitForPlatform(chunks, MASTODON_CONFIG, options);
      assert.equal(result[0].text, 'Hello #test');
    });

    it('should apply both prefix and suffix to a single post', () => {
      const chunks = [{ text: 'Hello', images: [] }];
      const options = { prefix: '📝 ', suffix: '#test', thread_style: '' };
      const result = splitForPlatform(chunks, MASTODON_CONFIG, options);
      assert.equal(result[0].text, '📝 Hello #test');
    });

    it('should apply thread_style numbering for multi-post threads', () => {
      const chunks = [
        { text: 'Part 1', images: [] },
        { text: 'Part 2', images: [] },
      ];
      const options = { prefix: '', suffix: '', thread_style: '{current}/{total}' };
      const result = splitForPlatform(chunks, MASTODON_CONFIG, options);
      assert.equal(result.length, 2);
      assert.ok(result[0].text.includes('1/2'));
      assert.ok(result[1].text.includes('2/2'));
    });

    it('should not apply thread_style for single posts', () => {
      const chunks = [{ text: 'Single post', images: [] }];
      const options = { prefix: '', suffix: '', thread_style: '{current}/{total}' };
      const result = splitForPlatform(chunks, MASTODON_CONFIG, options);
      assert.equal(result.length, 1);
      assert.ok(!result[0].text.includes('1/1'));
    });
  });

  describe('image preservation', () => {
    it('should keep images attached to their chunk', () => {
      const chunks = [
        { text: 'No image here', images: [] },
        { text: 'Image here', images: [{ alt: 'test', path: './test.png' }] },
      ];
      const result = splitForPlatform(chunks, MASTODON_CONFIG, NO_OPTIONS);
      assert.equal(result.length, 2);
      assert.equal(result[0].images.length, 0);
      assert.equal(result[1].images.length, 1);
      assert.equal(result[1].images[0].path, './test.png');
    });
  });
});
