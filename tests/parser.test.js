import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, processBlock } from '../src/parser.js';

describe('parseFrontmatter', () => {
  it('should parse a valid frontmatter block', () => {
    const content = `---
yodelog: true
prefix: "📝 "
suffix: "#journal #notes"
thread_style: "{current}/{total} 🧵"
---

# My Log
`;
    const result = parseFrontmatter(content);
    assert.equal(result.yodelog, true);
    assert.equal(result.prefix, '📝 ');
    assert.equal(result.suffix, '#journal #notes');
    assert.equal(result.thread_style, '{current}/{total} 🧵');
  });

  it('should return defaults when no frontmatter is present', () => {
    const content = 'Just some text without frontmatter.';
    const result = parseFrontmatter(content);
    assert.equal(result.yodelog, false);
    assert.equal(result.prefix, '');
    assert.equal(result.suffix, '');
    assert.equal(result.thread_style, '');
  });

  it('should handle frontmatter with only the required flag', () => {
    const content = `---
yodelog: true
---

Some content.
`;
    const result = parseFrontmatter(content);
    assert.equal(result.yodelog, true);
    assert.equal(result.prefix, '');
    assert.equal(result.suffix, '');
  });

  it('should handle single-quoted values', () => {
    const content = `---
yodelog: true
suffix: '#test'
---
`;
    const result = parseFrontmatter(content);
    assert.equal(result.suffix, '#test');
  });

  it('should ignore inline comments', () => {
    const content = `---
yodelog: true  # this is a comment
suffix: hello
---
`;
    const result = parseFrontmatter(content);
    assert.equal(result.yodelog, true);
    assert.equal(result.suffix, 'hello');
  });

  it('should ignore unknown keys', () => {
    const content = `---
yodelog: true
unknown_key: some value
suffix: "#test"
---
`;
    const result = parseFrontmatter(content);
    assert.equal(result.yodelog, true);
    assert.equal(result.suffix, '#test');
    assert.equal(result.unknown_key, undefined);
  });
});

describe('processBlock', () => {
  it('should not include heading text in content (as it is not broadcast)', () => {
    const block = { heading: 'My first post', rawContent: 'Hello world!' };
    const result = processBlock(block);
    assert.equal(result.heading, 'My first post');
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].text, 'Hello world!');
  });

  it('should handle empty heading (## without text)', () => {
    const block = { heading: '', rawContent: 'Just the content.' };
    const result = processBlock(block);
    assert.equal(result.heading, '');
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].text, 'Just the content.');
  });

  it('should split on manual thread breaks (---)', () => {
    const block = {
      heading: 'Thread',
      rawContent: 'Part 1.\n\n---\nPart 2.\n\n---\nPart 3.',
    };
    const result = processBlock(block);
    assert.equal(result.chunks.length, 3);
    assert.equal(result.chunks[0].text, 'Part 1.');
    assert.equal(result.chunks[1].text, 'Part 2.');
    assert.equal(result.chunks[2].text, 'Part 3.');
  });

  it('should extract images and strip them from text', () => {
    const block = {
      heading: 'Image post',
      rawContent: 'Look at this:\n\n![My diagram](./assets/diagram.png)\n\nPretty neat!',
    };
    const result = processBlock(block);
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].images.length, 1);
    assert.equal(result.chunks[0].images[0].alt, 'My diagram');
    assert.equal(result.chunks[0].images[0].path, './assets/diagram.png');
    assert.ok(!result.chunks[0].text.includes('!['));
    assert.ok(result.chunks[0].text.includes('Pretty neat!'));
  });

  it('should attach images to the correct manual chunk', () => {
    const block = {
      heading: 'Multi-chunk images',
      rawContent: 'First chunk.\n\n---\nSecond chunk with image:\n\n![Photo](./photo.jpg)\n\n---\nThird chunk.',
    };
    const result = processBlock(block);
    assert.equal(result.chunks.length, 3);
    assert.equal(result.chunks[0].images.length, 0);
    assert.equal(result.chunks[1].images.length, 1);
    assert.equal(result.chunks[1].images[0].path, './photo.jpg');
    assert.equal(result.chunks[2].images.length, 0);
  });

  it('should omit heading-only blocks (no body content) since headings are not broadcast', () => {
    const block = { heading: 'Just a heading', rawContent: '' };
    const result = processBlock(block);
    assert.equal(result.chunks.length, 0);
  });
});
