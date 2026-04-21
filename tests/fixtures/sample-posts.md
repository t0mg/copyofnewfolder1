---
yodelog: true
suffix: "#test"
thread_style: "{current}/{total}"
---

# Test File

## Simple post
This is a simple test post.

## Post with image
Check this out:

![Test image](./assets/test.png)

Pretty cool right?

## Long post for threading
This is the first paragraph of a very long post that should trigger auto-threading on BlueSky because it exceeds the 300 grapheme limit. We need to write enough content here to make it realistic.

This is the second paragraph. The splitter should find this paragraph break and use it as the primary split point. This is much better than splitting mid-sentence.

This is the third paragraph with even more content. We want to make sure the splitter handles multiple paragraphs correctly and distributes them across thread chunks.

## Post with manual thread breaks
First part of the thread.

---
Second part, manually separated.

---
Third part, also manually separated.

## 
This post has an empty heading — the heading text should not appear in the broadcast.
