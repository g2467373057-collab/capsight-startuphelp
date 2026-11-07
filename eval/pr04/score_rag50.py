"""After the human scorer has filled "Your result" in the filled RAG workbook, compute the final numbers.

    python3 eval/pr04/score_rag50.py eval/pr04/runs/rag50-<stamp>/PR04_50_RAG_Question_Bank_filled.xlsx

Correctness comes ONLY from the human column. The AI pre-score is used for one thing:
how often the human overruled it (override rate).
"""
import sys
import openpyxl

wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb["TEST THE 50 QUESTIONS"]
head = [str(c.value or "").strip() for c in ws[1]]
h = head.index("Your result")
p = next(i for i, x in enumerate(head) if x.startswith("AI pre-score (to confirm"))
rows = [[c.value for c in r] for r in ws.iter_rows(min_row=2) if r[0].value]
human = [(str(r[h] or "").strip().title(), str(r[p] or "").strip().title(), r[0]) for r in rows]
scored = [x for x in human if x[0] in ("Acceptable", "Partial", "Reject")]
n = len(scored)
if not n:
    sys.exit("No human scores yet in 'Your result'.")
acc = sum(1 for x in scored if x[0] == "Acceptable")
par = sum(1 for x in scored if x[0] == "Partial")
rej = n - acc - par
over = [x for x in scored if x[1] in ("Acceptable", "Partial", "Reject") and x[1] != x[0]]
pct = lambda k: f"{k}/{n} ({round(100 * k / n)}%)"
print(f"Human-scored: n = {n} of {len(rows)}")
print(f"Acceptable: {pct(acc)}   Partial: {pct(par)}   Reject: {pct(rej)}")
print(f"Acceptable + Partial: {pct(acc + par)}")
print(f"F1 bar (>= 85% correct): {'MET' if acc / n >= 0.85 else 'NOT MET'} if 'correct' = Acceptable only; "
      f"{'MET' if (acc + par) / n >= 0.85 else 'NOT MET'} if Partial also counts (team to decide before reading these).")
print(f"Human overruled the AI pre-score on {len(over)} of {n} ({round(100 * len(over) / n)}%): " + ", ".join(f"{x[2]} {x[1]}→{x[0]}" for x in over))
