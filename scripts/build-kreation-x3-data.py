"""Builds src/data/kreationX3.json from the 2026 Kreation X3 calculator workbook.

Usage: python3 scripts/build-kreation-x3-data.py path/to/2026_NEW_KREATION_X3_CALCULATOR.xlsx

Only the NETT column (F) is read. CPL is never exported. Descriptions are copied as-is.
Two agreed corrections: the Chest of Drawer 1200W body gets its item code, and the
single locker NETT prices are rounded to whole rupees.
"""
import json, sys
import openpyxl

CODE_FIXES = {("CHEST OF DRAWER", "KreX3ChestDwBd1200WAlWh"): "30161803SD01265"}
ROUND_NETT_CODES = {"30161803SD01285", "30161803SD01286"}  # single locker 450W / 600W

wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
sheets = []
for ws in wb:
    sections, cur, seen = [], None, set()
    for r in range(3, ws.max_row + 1):
        v = [c.value for c in ws[r]]
        if v[0] and v[0] != "TOTAL" and v[1] is None and v[3] is None:
            cur = {"name": v[0].strip(), "items": []}
            sections.append(cur)
            continue
        if isinstance(v[5], (int, float)) and v[1] and cur is not None:
            desc = v[1].strip()
            code = CODE_FIXES.get((ws.title, desc), v[0] or "")
            nett = round(v[5], 4)
            if code in ROUND_NETT_CODES:
                nett = float(round(nett))
            key = code or desc
            assert key not in seen, f"duplicate {key} in {ws.title}"
            seen.add(key)
            # [item code, item description, long description, NETT]
            cur["items"].append([code, desc, v[2].strip() if v[2] else desc, nett])
    sheets.append({"id": ws.title, "sections": [s for s in sections if s["items"]]})

with open("src/data/kreationX3.json", "w") as f:
    json.dump(sheets, f, separators=(",", ":"))
for s in sheets:
    print(s["id"], sum(len(x["items"]) for x in s["sections"]), "items")
