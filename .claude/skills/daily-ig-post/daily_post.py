#!/usr/bin/env python3
"""Pick today's product from the HDE website catalogue and render a 1080x1350 Instagram post.

usage: daily_post.py --site /path/to/hdewebsite/site [--date YYYY-MM-DD] [--out DIR] [--room ROOM] [--id PRODUCT_ID]
Writes DIR/<date>/post.png and DIR/<date>/post.json (the facts a caption may use).
No network, no pip dependencies: needs python3 and a Chromium binary.
"""
import argparse, datetime, hashlib, html, json, os, pathlib, shutil, subprocess, sys

ROOMS = ["living", "bedroom", "storage", "office", "dining"]  # Mon..Fri rotation; Sat/Sun reuse
THEME = {"living": "Living room", "bedroom": "Bedroom", "storage": "Storage & wardrobes",
         "office": "Home office", "dining": "Dining"}


def load_catalog(site):
    s = (site / "assets/js/catalog.js").read_text(encoding="utf-8")
    i = s.index("products: [") + len("products: ")
    return json.loads(s[i:s.rindex("]") + 1])


def find_chrome():
    for p in [os.environ.get("CHROME_BIN"), shutil.which("chromium"), shutil.which("google-chrome")]:
        if p and os.path.exists(p):
            return p
    hits = sorted(pathlib.Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")).glob("chromium-*/chrome-linux*/chrome"))
    if hits:
        return str(hits[-1])
    sys.exit("no chromium found; set CHROME_BIN")


def pick(products, site, day, room, pid):
    ok = [p for p in products if p.get("from") and (site / p["image"].split("?")[0]).exists()]
    if pid:
        m = [p for p in ok if p["id"] == pid]
        if not m:
            sys.exit(f"product {pid} not found with image and price")
        return m[0]
    room = room or ROOMS[day.weekday() % len(ROOMS)]
    pool = sorted((p for p in ok if p["room"] == room), key=lambda p: p["id"])
    # deterministic per date, rotates through the room's catalogue, one product per family
    seen, fam = set(), []
    for p in pool:
        k = p.get("family") or p["name"]
        if k not in seen:
            seen.add(k); fam.append(p)
    h = int(hashlib.sha256(day.isoformat().encode()).hexdigest(), 16)
    return fam[h % len(fam)]


def inr(n):
    s = str(int(n)); head, tail = s[:-3], s[-3:]
    out = ""
    while len(head) > 2:
        out = "," + head[-2:] + out; head = head[:-2]
    return "₹" + (head + out + "," + tail if head or out else tail)


PAGE = """<!doctype html><meta charset=utf-8><style>
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1350px;background:#f6efe6;font-family:'Josefin Sans','DejaVu Sans',sans-serif;color:#3b2a1e;position:relative;overflow:hidden}
.top{position:absolute;top:0;left:0;right:0;height:120px;background:#3b2a1e;color:#e6c98a;display:flex;align-items:center;justify-content:space-between;padding:0 56px;font-size:22px;letter-spacing:2px;white-space:nowrap;gap:24px}
.top b{font-family:'Cinzel','DejaVu Serif',serif;font-size:32px;letter-spacing:4px}
.photo{position:absolute;top:150px;left:56px;right:56px;height:760px;background:#fff;border:2px solid #c9a24d;display:flex;align-items:center;justify-content:center}
.photo img{width:100%;height:100%;object-fit:contain}
.tag{position:absolute;top:174px;left:80px;background:#c9a24d;color:#fff;padding:10px 22px;font-size:26px;letter-spacing:3px;text-transform:uppercase}
h1{position:absolute;top:940px;left:56px;right:56px;font-family:'Cinzel','DejaVu Serif',serif;font-size:50px;line-height:1.15;font-weight:600;max-height:120px;overflow:hidden}
.price{position:absolute;top:1090px;left:56px;font-size:40px;color:#8a5a2b}
.price small{font-size:26px;color:#6b5a4b}
.cta{position:absolute;bottom:0;left:0;right:0;height:150px;background:#c9a24d;color:#2a1c12;padding:26px 56px;font-size:25px;line-height:1.4}
.cta b{font-size:40px}
</style>
<div class=top><b>HOME DECOR ENTERPRISES</b><span>DEHRADUN · SINCE 2006</span></div>
<div class=photo><img src="__IMG__"></div><div class=tag>__THEME__</div>
<h1>__NAME__</h1>
<div class=price>__PRICE__ <small>MRP, ask for our best price</small></div>
<div class=cta><b>WhatsApp 99172 33664</b><br>Godrej Interio · Delivery &amp; installation · hdefurniture.netlify.app</div>"""


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--site", required=True); a.add_argument("--date")
    a.add_argument("--out", default="ig-posts"); a.add_argument("--room"); a.add_argument("--id")
    a = a.parse_args()
    site = pathlib.Path(a.site).resolve()
    day = datetime.date.fromisoformat(a.date) if a.date else datetime.date.today()
    prods = load_catalog(site)
    p = pick(prods, site, day, a.room, a.id)
    out = pathlib.Path(a.out) / day.isoformat(); out.mkdir(parents=True, exist_ok=True)
    img = (site / p["image"].split("?")[0]).resolve()
    name = (p.get("family") or p["name"]).split(" (")[0]
    page = (PAGE.replace("__IMG__", img.as_uri()).replace("__THEME__", html.escape(THEME[p["room"]]))
            .replace("__NAME__", html.escape(name)).replace("__PRICE__", "From " + inr(p["from"])))
    (out / "post.html").write_text(page, encoding="utf-8")
    subprocess.run([find_chrome(), "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                    "--allow-file-access-from-files", "--window-size=1080,1437",
                    f"--screenshot={out/'post.png'}", (out / "post.html").resolve().as_uri()],
                   check=True, capture_output=True, timeout=90)
    # headless Chrome's window is 87px taller than the page viewport it screenshots: crop back to 1080x1350
    from PIL import Image
    im = Image.open(out / "post.png"); im.crop((0, 0, 1080, 1350)).save(out / "post.png")
    facts = {"date": day.isoformat(), "id": p["id"], "name": name, "room": p["room"], "from_mrp_inr": p["from"],
             "note": p.get("note", ""), "source": p.get("source"), "image": str(img),
             "link": f"https://hdefurniture.netlify.app/product.html?id={p['id']}"}
    (out / "post.json").write_text(json.dumps(facts, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(facts, ensure_ascii=False))


main()
