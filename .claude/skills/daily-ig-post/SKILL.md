---
name: daily-ig-post
description: Create today's Instagram post for Home Decor Enterprises from the website product catalogue. Use when the user says "daily post", "post for today", "make an Instagram post from the website", "visualise a product post", or wants a ready-to-upload 1080x1350 image plus caption for @godrej_interio_ddn.
---

# daily-ig-post

Turns the website catalogue (`Sachdhingra/hdewebsite`, `site/assets/js/catalog.js` plus product photos in `site/assets/img/products/`) into one ready-to-post Instagram image and a caption. The image is rendered by `daily_post.py` in this folder; the caption is written by Claude with the `ig-caption` and `ig-human` skills and `.claude/instagram/voice.md`.

Paths below are relative to the repo root (`hdeomniflow/`).

## Prerequisites

- python3 with Pillow, and a Chromium binary (`/opt/pw-browsers/chromium-*` is found automatically; otherwise set `CHROME_BIN`).
- A local copy of the website repo. The live site is not reachable from the cloud container, so clone it:

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/Sachdhingra/hdewebsite /home/user/sachdhingra/hdewebsite
```

## Run

1. Render the post (the product is picked deterministically from the date; weekdays rotate living, bedroom, storage, office, dining):

```bash
python3 .claude/skills/daily-ig-post/daily_post.py --site /home/user/sachdhingra/hdewebsite/site --date 2026-10-22 --out ig-posts
```

   Output: `ig-posts/<date>/post.png` (1080x1350), `post.html` and `post.json`. The command prints the same facts as JSON. Options: `--room living|bedroom|storage|office|dining`, `--id <product id>` to force a product.

2. **Look at `post.png`** before going further (read the file as an image).
3. Write the caption from `post.json` only: name, room, `from_mrp_inr`, `note`, `link`. Follow `.claude/instagram/voice.md` (Hindi and English mix, one emoji at most, keyword CTA `FURNITURE`, WhatsApp 9917233664). Run it through `/ig-caption` and `/ig-human`. Save as `ig-posts/<date>/caption.txt`.
4. Hand the folder to the owner. **Posting is manual**: no Instagram API credentials are connected, so nothing here publishes.

## Rules for the content

- Prices are the catalogue's MRP ("From ₹x"), labelled MRP. Do not state a discount; the team quotes its own price on enquiry.
- Say only what `post.json` supports. Do not invent warranty terms, delivery times or reviews.
- Do not post customer names, bills or leads.

## Gotchas

- Headless Chrome's screenshot is 87px taller than the page; the script requests a 1437px window and crops to 1350. Do not change `--window-size` without changing the crop.
- No Cinzel/Josefin fonts are installed in the container, so the image uses DejaVu fallbacks. Install the fonts for the brand look.
- No Devanagari font is installed: keep Hindi out of the image text (captions are fine).
- Source photos are small (about 640x360), so they look soft at full width.
- `hdefurniture.netlify.app` is blocked by this container's network policy, hence the local clone. After a website sync, `git pull` the clone to get new products.
