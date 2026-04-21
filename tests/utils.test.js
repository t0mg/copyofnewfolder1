import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countGraphemes,
  mastodonCharCount,
  findUrls,
  findHashtags,
  generateBskyFacets,
  extractImages,
  stripImages,
  formatThreadStyle,
  mimeFromPath,
} from '../src/utils.js';

describe('countGraphemes', () => {
  it('should count ASCII characters', () => {
    assert.equal(countGraphemes('hello'), 5);
  });

  it('should count emoji as single graphemes', () => {
    assert.equal(countGraphemes('👋🌍'), 2);
  });

  it('should count combined emoji as single graphemes', () => {
    // Family emoji (ZWJ sequence) should be 1 grapheme
    assert.equal(countGraphemes('👨‍👩‍👧‍👦'), 1);
  });

  it('should handle empty string', () => {
    assert.equal(countGraphemes(''), 0);
  });

  it('should handle mixed content', () => {
    assert.equal(countGraphemes('Hi 👋'), 4);
  });
});

describe('mastodonCharCount', () => {
  it('should count plain text normally', () => {
    assert.equal(mastodonCharCount('hello world'), 11);
  });

  it('should count URLs as 23 characters', () => {
    const text = 'Check this out: https://example.com/very/long/path/that/is/way/more/than/23/characters';
    const count = mastodonCharCount(text);
    // "Check this out: " = 16 chars + URL counted as 23 = 39
    assert.equal(count, 39);
  });

  it('should handle multiple URLs', () => {
    const text = 'Visit https://a.com and https://b.com';
    const count = mastodonCharCount(text);
    // "Visit " (6) + 23 + " and " (5) + 23 = 57
    // Actual URL lengths: "https://a.com" (13), "https://b.com" (13)
    // Adjustment: (13-23) + (13-23) = -20
    // text.length (37) - (-20) = 57
    assert.equal(count, 57);
  });
});

describe('findUrls', () => {
  it('should find URLs in text', () => {
    const text = 'Visit https://example.com for more info.';
    const urls = findUrls(text);
    assert.equal(urls.length, 1);
    assert.equal(urls[0].text, 'https://example.com');
  });

  it('should find multiple URLs', () => {
    const text = 'See https://a.com and http://b.com/path';
    const urls = findUrls(text);
    assert.equal(urls.length, 2);
  });

  it('should return empty for text without URLs', () => {
    assert.equal(findUrls('no urls here').length, 0);
  });
});

describe('findHashtags', () => {
  it('should find hashtags', () => {
    const text = 'Building things #buildinpublic #opensource';
    const tags = findHashtags(text);
    assert.equal(tags.length, 2);
    assert.equal(tags[0].tag, 'buildinpublic');
    assert.equal(tags[1].tag, 'opensource');
  });

  it('should not match hash in URLs', () => {
    const text = 'https://example.com#anchor';
    const tags = findHashtags(text);
    assert.equal(tags.length, 0);
  });

  it('should find hashtag at start of text', () => {
    const tags = findHashtags('#hello world');
    assert.equal(tags.length, 1);
    assert.equal(tags[0].tag, 'hello');
  });
});

describe('generateBskyFacets', () => {
  it('should generate link facets for URLs', () => {
    const text = 'Visit https://example.com today';
    const facets = generateBskyFacets(text);
    assert.equal(facets.length, 1);
    assert.equal(facets[0].features[0].$type, 'app.bsky.richtext.facet#link');
    assert.equal(facets[0].features[0].uri, 'https://example.com');
  });

  it('should generate tag facets for hashtags', () => {
    const text = 'Building #awesome things';
    const facets = generateBskyFacets(text);
    assert.equal(facets.length, 1);
    assert.equal(facets[0].features[0].$type, 'app.bsky.richtext.facet#tag');
    assert.equal(facets[0].features[0].tag, 'awesome');
  });

  it('should generate both link and tag facets', () => {
    const text = 'Check https://example.com #cool';
    const facets = generateBskyFacets(text);
    assert.equal(facets.length, 2);
  });
});

describe('extractImages', () => {
  it('should extract markdown images', () => {
    const text = 'Look: ![alt text](./path/to/image.png) cool!';
    const images = extractImages(text);
    assert.equal(images.length, 1);
    assert.equal(images[0].alt, 'alt text');
    assert.equal(images[0].path, './path/to/image.png');
  });

  it('should extract multiple images', () => {
    const text = '![a](./1.png) and ![b](./2.jpg)';
    const images = extractImages(text);
    assert.equal(images.length, 2);
  });

  it('should handle empty alt text', () => {
    const images = extractImages('![](./img.png)');
    assert.equal(images.length, 1);
    assert.equal(images[0].alt, '');
  });
});

describe('stripImages', () => {
  it('should remove image markdown from text', () => {
    const text = 'Before\n\n![alt](./img.png)\n\nAfter';
    const result = stripImages(text);
    assert.ok(!result.includes('!['));
    assert.ok(result.includes('Before'));
    assert.ok(result.includes('After'));
  });

  it('should handle text with no images', () => {
    assert.equal(stripImages('no images here'), 'no images here');
  });
});

describe('formatThreadStyle', () => {
  it('should replace {current} and {total} placeholders', () => {
    assert.equal(formatThreadStyle('{current}/{total}', 1, 3), '1/3');
  });

  it('should handle emoji in template', () => {
    assert.equal(formatThreadStyle('{current}/{total} 🧵', 2, 5), '2/5 🧵');
  });

  it('should handle bracket-style template', () => {
    assert.equal(formatThreadStyle('[{current}/{total}]', 1, 2), '[1/2]');
  });
});

describe('mimeFromPath', () => {
  it('should detect JPEG', () => {
    assert.equal(mimeFromPath('photo.jpg'), 'image/jpeg');
    assert.equal(mimeFromPath('photo.jpeg'), 'image/jpeg');
  });

  it('should detect PNG', () => {
    assert.equal(mimeFromPath('image.png'), 'image/png');
  });

  it('should detect WebP', () => {
    assert.equal(mimeFromPath('image.webp'), 'image/webp');
  });

  it('should return octet-stream for unknown extensions', () => {
    assert.equal(mimeFromPath('file.xyz'), 'application/octet-stream');
  });
});
