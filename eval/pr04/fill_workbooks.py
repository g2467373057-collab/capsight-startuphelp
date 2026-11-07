"""Copy the PR04 workbooks and fill in what the system produced, ready for human scoring.

    python3 eval/pr04/fill_workbooks.py eval/pr04/runs/rag50-<stamp>
    python3 eval/pr04/fill_workbooks.py eval/pr04/runs/founder-<stamp>

Only the "Capsight answer", "Sources Capsight gave" and "Report link / file" cells are filled.
Scores (Acceptable / Partial / Reject, Good / Partly / Wrong) are left empty: a person decides them.
Needs openpyxl (pip install openpyxl).
"""
import csv, json, shutil, sys
from datetime import date
from pathlib import Path

import openpyxl

here = Path(__file__).resolve().parent
run = Path(sys.argv[1]).resolve()
stamp = f"auto-run {date.today().isoformat()} ({run.name}); NOT YET SCORED"

if run.name.startswith("rag50"):
    src = here / "templates" / "PR04_50_RAG_Question_Bank.xlsx"
    dst = run / "PR04_50_RAG_Question_Bank_filled.xlsx"
    shutil.copy(src, dst)
    wb = openpyxl.load_workbook(dst)
    ws = wb["TEST THE 50 QUESTIONS"]
    head = [str(c.value or "").strip() for c in ws[1]]
    col = {name: head.index(name) + 1 for name in head if name}
    results = {r["id"]: r for r in json.loads((run / "results.json").read_text())}
    n = 0
    for row in range(2, ws.max_row + 1):
        rid = ws.cell(row, 1).value
        r = results.get(rid)
        if not r:
            continue
        ws.cell(row, col["Capsight answer (paste)"]).value = r["answer"]
        ws.cell(row, col["Sources Capsight gave"]).value = r["sources"] or "(no verified source)"
        ws.cell(row, col["Tester / date"]).value = stamp
        n += 1
    wb.save(dst)
    print(f"filled {n} rows → {dst}")
elif run.name.startswith("founder"):
    src = here / "templates" / "PR04_10_Founder_Tests_xlsx.xlsx"
    dst = run / "PR04_10_Founder_Tests_filled.xlsx"
    shutil.copy(src, dst)
    wb = openpyxl.load_workbook(dst)
    index = {r["id"]: r for r in csv.DictReader(open(run / "index.csv", encoding="utf-8-sig"))}
    n = 0
    for tc, r in index.items():
        if tc not in wb.sheetnames or not r["report_file"]:
            continue
        ws = wb[tc]
        for row in range(1, ws.max_row + 1):
            label = str(ws.cell(row, 1).value or "").strip()
            if label == "Report link / file":
                ws.cell(row, 2).value = f"{run.name}/{r['report_file']}"
            elif label == "Tester and test date":
                ws.cell(row, 2).value = stamp
        n += 1
    wb.save(dst)
    print(f"filled {n} scenarios → {dst}")
else:
    sys.exit("expected a rag50-… or founder-… run folder")
