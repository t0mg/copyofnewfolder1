# 🏔️🎶 Yodelog

**Write Markdown. Push to GitHub. Broadcast everywhere.**

Yodelog is a stateless, serverless microblogging pipeline. Write your micro-posts inside Markdown files, push to `main`, and a GitHub Action automatically broadcasts them to **Mastodon** and **BlueSky**. Keep your repository private, or make it public to also publish your content as a [Docsify](https://docsify.js.org/) website on **GitHub Pages**.

---

## 🪵 Features

- **Multiple Outlets** — Broadcast your thoughts to Mastodon, BlueSky, or publish as a Docsify web view.
- **Zero Config** — Works instantly as a GitHub Template. Missing API keys will just log a dry-run.
- **Smart Threading** — Long posts automatically split into numbered threads at safe boundaries.
- **Manual Threads** — Force a new thread reply with a horizontal rule (`---`).
- **Append-Only** — "Push" mode relies on `git diff`. Just add new content to your markdown file and commit to broadcast it.
- **Scheduled Posts** — Use "Schedule" mode and add a `{time: YYYY-MM-DDTHH:MMZ}` tag to broadcast later.
- **Image Support** — Standard Markdown images stay attached to the relevant thread chunk, with alt text.
- **No Dependencies** — Pure Node.js 22, meaning fast execution and zero supply-chain risk. Note that broadcasting relies entirely on GitHub Actions

## 🐐 Quick Start

### 1. Use This Template

Click **"Use this template"** on GitHub to create your own repository.

### 2. Add Your Secrets

Go to **Settings → Secrets and variables → Actions** in your new repository.

You'll need to create one **repository variable** and one **repository secret** for each platform.

#### For Mastodon

| Type | Name | Value |
|------|------|-------|
| Variable | `MASTODON_INSTANCE_URL` | e.g. `https://mastodon.social` |
| Secret | `MASTODON_ACCESS_TOKEN` | Your Mastodon access token |

To create an access token:
1. On your Mastodon instance, click **New applicaction** in **Preferences → Development** ([example on mastodon.social](https://mastodon.social/settings/applications/new)).
2. Create an application with `write:media` and `write:statuses` permissions.
3. Click on the newly created application, and copy the token labeled as `Your access token`.

#### For BlueSky

| Type | Name | Value |
|------|------|-------|
| Variable | `BLUESKY_HANDLE` | e.g. `you.bsky.social` |
| Secret | `BLUESKY_APP_PASSWORD` | Your BlueSky App Password |

To create an App Pasword:
1. In BlueSky, go to **Settings → Privacy and Security → [App Passwords](https://bsky.app/settings/app-passwords)**.
2. Add a new App password for your Yodelog.

### 3. Write & Push

Create any `.md` file (e.g., `journal.md`) and add:

```markdown
---
yodelog: true
---

## My first broadcast
Hello from my git-powered microblog! 🎉
```

Commit and push to `main`. The GitHub Action detects the new `##` heading and broadcasts it. Done!


## 🧀 Writing & Publishing

### File Structure & Frontmatter
Organize your markdown files however you like: any `.md` file with a `yodelog: true` frontmatter style metadata header will be scanned. Here are all the available options:

```yaml
---
yodelog: true                     # REQUIRED
prefix: "🏔️ "                     # OPTIONAL — prepended to the first post
suffix: "#yodelog #notes"         # OPTIONAL — appended to the last post
thread_style: "{current}/{total}" # OPTIONAL — numbering style
post_on: push_or_schedule         # OPTIONAL — push | schedule | push_or_schedule (default: push_or_schedule)
---
```

### Headings = Posts
Each `##` heading marks a new post. That's it. Content too long for a target platform will be split into multiple posts. 

The heading titles are only visible in the Docsify [web version](#-public-web-view) if you use it. They are **not** included in social media posts.

```markdown
##
I had no inspiration for a title but this is technically valid, which is the best kind of valid.

## This header line is not visible on social.
Something loud is coming soon...
```

Yodelog is an **append-only log**. Edits or deletions of old posts are not reflected on Mastodon or BlueSky.

### Scheduled Posts
To schedule a post, add a `{time: ...}` tag in ISO 8601 format to your heading. A cron job checks every hour and broadcasts it when the time arrives.

```markdown
## Transmedia expansion announcement {time: 2026-06-01T09:00Z}
We're thrilled to announce the production of "Yodelog, The Movie"!
```

If your file uses `post_on: push_or_schedule` (the default), posts without a `{time: ...}` tag will broadcast immediately on push, while those with a tag are skipped by the push trigger and deferred to the cron job.

### Manual Threads & Images
Use `---` on its own line to force thread breaks within a single post. Note that due to the stateless nature of this project, it is not possible to continue an existing thread.

Standard Markdown images are supported (alt text is preserved, files are compressed to fit the size limits of the target platform).

```markdown
## My hot take
This is part 1 of my carefully paced thread.

---
Part 2 here. Pause for effect.

---
And this is part 3. Boom.
![Image path is relative to the markdown file](./yodelogmoviecover.png)

```

### Dry-Run Mode

Want to test without posting? Set `yodelog: false` in the header of your file, or name it with `.dryrun.md` (e.g., `draft.dryrun.md`). The GitHub Actions will log what *would* be sent, skipping actual API calls. Missing API credentials will also trigger dry-run mode automatically.

## 🐄 Public Web View

Yodelog includes an `index.html` file to optionally surface your microblog on GitHub Pages using [Docsify](https://docsify.js.org/).

1. In GitHub, go to **Settings → Pages**.
2. Select **Deploy from a branch**, set it to `main`, and folder to `/root`. Click **Save**.
3. Create a `_sidebar.md` to link to your files for site navigation.

Within minutes, your markdown files will be visible as a public website.

## 🌲 Maintenance

### Updating from Template
Since this repository was created from a template, you might want to pull updates (bug fixes or new features) from the original [t0mg/yodelog](https://github.com/t0mg/yodelog) repository.

1. Go to the **Actions** tab in your repository.
2. Select the **Update from Template** workflow on the left.
3. Click **Run workflow**.

If there are any changes, a new Pull Request will be opened for you to review and merge.

### Repository Structure

```
├── .github/workflows/
│   ├── broadcast.yml                — Push-triggered instant broadcasting
│   ├── schedule.yml                 — Cron-triggered scheduled broadcasting
│   └── update.yml                   — Update from template workflow
├── content/
│   ├── _sidebar.md                  - Example web only sidebar
│   ├── about.md                     - Example web only content page
│   ├── posts.md                     - Example post file
├── src/
│   ├── main.js                      — Pipeline orchestrator (instant + cron modes)
│   ├── diff.js                      — Git diff engine (append-only reader)
│   ├── parser.js                    — Frontmatter + content + schedule tag parser
│   ├── schedule.js                  — Watermark management + scheduled post scanner
│   ├── splitter.js                  — Smart thread splitting
│   ├── platforms/
│   │   ├── mastodon.js              — Mastodon API client
│   │   └── bluesky.js               — BlueSky AT Protocol client
│   └── utils.js                     — Shared helpers
├── index.html                       — Docsify web entry point
└── package.json                     — Metadata (no dependencies)
```
