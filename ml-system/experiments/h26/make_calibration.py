"""Step-2 tooling: build the human-agreement calibration set (§8 / §F / build-doc calibration spec).

The judge envelope (prompt / K / determinism) is tuned to best match Brian's *own* forced-choice
compatibility judgments on a held-out set — a **human label on purpose**, disjoint from every gated
question. This module: (1) draws ~N FITB questions from the **valid + train** splits (so they are
automatically disjoint from the test-only gate-B/gate-D sets — the §F blindness guarantee), (2) exports
a **self-contained HTML viewer** (garment photos + A–D radios + a "download my answers" button — the
image-only modality that matches the headline judge), and (3) assembles the downloaded answers into the
committed `calibration_set.json` (the `evaluate.py` unlock binds it by sha and asserts its `question_ids`
touch no gated question).

Workflow (after the Step-1 cache/training run frees the parquet):
    .venv/bin/python make_calibration.py            # writes calibration_viewer.html
    # open calibration_viewer.html, pick A/B/C/D for each, click "Download my answers"
    .venv/bin/python -c "import make_calibration as m; m.finalize('calibration_answers.json')"

Reference: docs/plans/h26-compatibility-spike-v2.md §8 / preregistration.md §F.
"""

from __future__ import annotations

import html
import json
import os

from data_loader import Corpus, FitbQuestion, build_fitb, load_headline_corpus
from gpt_judge import CHOICE_LABELS

ROOT_DIR = os.path.dirname(__file__)
CALIB_SEED = 424242          # distinct from the headline seed 20260629 (a separate draw)
CALIB_SIZE = 60              # >= the §F floor of ~50
VIEWER = os.path.join(ROOT_DIR, "calibration_viewer.html")
QUESTIONS_CACHE = os.path.join(ROOT_DIR, "calibration_questions.json")  # the drawn questions (regenerable)


def build_calibration_questions(
    corpus: Corpus, *, n: int = CALIB_SIZE, seed: int = CALIB_SEED
) -> list[FitbQuestion]:
    """Draw `n` FITB questions from valid + train (NEVER test — the gate-B/gate-D sets are test-only, so
    valid/train questions are disjoint by construction, §F). Deterministic from `seed`; one question per
    distinct outfit. `build_fitb` already shuffles within a split; we concatenate valid-then-train and
    take the first `n` so the set is stable."""
    questions: list[FitbQuestion] = []
    for split in ("valid", "train"):
        qs, _ = build_fitb(corpus.splits[split], corpus.item_index, seed)
        questions.extend(qs)
        if len(questions) >= n:
            break
    if len(questions) < n:
        raise ValueError(f"only {len(questions)} calibration questions available, need {n}")
    return questions[:n]


def _question_record(q: FitbQuestion) -> dict:
    return {
        "set_id": q.set_id,
        "retained": list(q.retained),
        "candidates": list(q.candidates),
        "correct_index": q.correct_index,      # the Polyvore held-out answer (NOT the human label)
        "answer_category": q.answer_category,
    }


def export_viewer(questions: list[FitbQuestion], provider, *, out_path: str = VIEWER) -> str:
    """Write a self-contained HTML viewer (images embedded as data URIs) — the owner picks A–D per
    question and downloads `{set_id: letter}`. `provider` is a `live_content.ParquetContentProvider`
    (its `data_uri(item_id)` supplies the `<img>` src). Also caches the drawn questions to
    `calibration_questions.json` so `finalize` can reconstruct them without re-drawing."""
    with open(QUESTIONS_CACHE, "w", encoding="utf-8") as f:
        json.dump({"seed": CALIB_SEED, "questions": [_question_record(q) for q in questions]}, f, indent=1)

    cards = []
    for i, q in enumerate(questions, 1):
        retained_imgs = "".join(f'<img src="{provider.data_uri(r)}" class="thumb">' for r in q.retained)
        cand_rows = []
        for label, c in zip(CHOICE_LABELS, q.candidates):
            cand_rows.append(
                f'<label class="cand"><input type="radio" name="{html.escape(q.set_id)}" value="{label}">'
                f'<span class="lab">{label}</span><img src="{provider.data_uri(c)}" class="thumb"></label>'
            )
        cards.append(
            f'<div class="q"><div class="qn">Q{i} / {len(questions)}</div>'
            f'<div class="partial"><b>Partial outfit:</b>{retained_imgs}</div>'
            f'<div class="ask">Which item best completes it?</div>'
            f'<div class="cands">{"".join(cand_rows)}</div></div>'
        )
    doc = _VIEWER_TEMPLATE.replace("__CARDS__", "\n".join(cards)).replace("__N__", str(len(questions)))
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(doc)
    return out_path


def assemble_calibration(questions: list[FitbQuestion], answers: dict[str, str]) -> dict:
    """Turn `{set_id: 'A'..}` picks into the `calibration_set.json` dict: `question_ids` (the unlock's
    disjointness input) + the full `questions` with the owner's `human_choice` (0-based index). Every
    question must be answered with a valid in-range label. Raises on a missing/invalid answer so a
    half-finished pass can't silently produce a short calibration set."""
    label_index = {lab: i for i, lab in enumerate(CHOICE_LABELS)}
    out_questions = []
    for q in questions:
        pick = answers.get(q.set_id)
        if pick is None:
            raise ValueError(f"no human answer for calibration question {q.set_id!r}")
        idx = label_index.get(str(pick).strip().upper())
        if idx is None or idx >= len(q.candidates):
            raise ValueError(f"answer {pick!r} for {q.set_id!r} is not a valid candidate label")
        rec = _question_record(q)
        rec["human_choice"] = idx
        out_questions.append(rec)
    return {
        "_README": (
            "Human-agreement calibration set (§F): actual-human single-annotator forced-choice picks on "
            "valid/train Polyvore FITB questions, image-only. question_ids feed the evaluate.py unlock "
            "disjointness check; human_choice (0-based candidate index) is the judge-selection target. "
            "NOT Polyvore co-occurrence ground truth. Judge-envelope selection only; never scores the head."
        ),
        "spike": "h26",
        "seed": CALIB_SEED,
        "source": "polyvore_valid_train_image_only",
        "single_annotator": True,
        "question_ids": [q.set_id for q in questions],
        "questions": out_questions,
    }


def finalize(answers_path: str, *, root_dir: str = ROOT_DIR) -> str:
    """Read the downloaded answers + the cached questions, write `calibration_set.json`. Run after the
    viewer is filled in."""
    cache = json.load(open(os.path.join(root_dir, "calibration_questions.json"), encoding="utf-8"))
    questions = [
        FitbQuestion(r["set_id"], tuple(r["retained"]), tuple(r["candidates"]), r["correct_index"], r["answer_category"])
        for r in cache["questions"]
    ]
    answers = json.load(open(answers_path, encoding="utf-8"))
    manifest = assemble_calibration(questions, answers)
    out = os.path.join(root_dir, "calibration_set.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    print(f"[calibration] wrote {out} ({len(manifest['question_ids'])} questions)")
    return out


def restability(first_answers_path: str, recheck_answers_path: str) -> float:
    """Compute the §8 intra-annotator stability: the fraction of RE-LABELED calibration questions whose
    second-pass pick matches the first pass. The judge_addendum.schema REQUIRES a real
    `calibration_set.intra_annotator_agreement` number, and §8/§F make the re-label check a firm invariant
    (catch a noisy labeler before it tunes the judge) — so this must be a measurement, not a hand-filled
    constant. Workflow: re-open `calibration_viewer.html`, re-answer a subset (or all) with a fresh eye,
    download the picks as `calibration_answers_recheck.json`, then run
    `python -c "import make_calibration as m; m.restability('calibration_answers.json', 'calibration_answers_recheck.json')"`.
    Reports the agreement over the shared questions to write into the frozen addendum."""
    first = json.load(open(first_answers_path, encoding="utf-8"))
    recheck = json.load(open(recheck_answers_path, encoding="utf-8"))
    shared = [k for k in recheck if k in first]
    if not shared:
        raise ValueError(
            "no shared re-labeled questions between the two passes — re-answer some of the SAME questions "
            "in calibration_viewer.html and download them as calibration_answers_recheck.json"
        )
    agree = sum(1 for k in shared if str(first[k]).strip().upper() == str(recheck[k]).strip().upper())
    rate = agree / len(shared)
    print(f"[calibration] intra-annotator agreement over {len(shared)} re-labeled questions: "
          f"{agree}/{len(shared)} = {rate:.3f}")
    print("[calibration] write this into judge_addendum.md -> calibration_set.intra_annotator_agreement "
          "(a low value flags a noisy labeler BEFORE it tunes the judge — §8/§F).")
    return rate


def main() -> None:
    """Draw the calibration questions + export the viewer (streams the gated parquet — run AFTER the
    Step-1 cache build finishes so it does not contend)."""
    from live_content import ParquetContentProvider

    corpus = load_headline_corpus(verbose=False)
    questions = build_calibration_questions(corpus)
    item_ids = {i for q in questions for i in (*q.retained, *q.candidates)}
    provider = ParquetContentProvider(item_ids)
    path = export_viewer(questions, provider)
    print(f"[calibration] wrote {path} — open it, pick A–D per question, click 'Download my answers',")
    print("[calibration] then: python -c \"import make_calibration as m; m.finalize('calibration_answers.json')\"")


_VIEWER_TEMPLATE = """<!doctype html><html><head><meta charset="utf-8">
<title>Fitted — calibration judgments</title><style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:20px;background:#fafafa}
.q{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}
.qn{color:#888;font-size:12px}.ask{margin:10px 0 6px;font-weight:600}
.thumb{height:120px;width:120px;object-fit:cover;border-radius:6px;margin:4px;vertical-align:middle;border:1px solid #eee}
.partial{margin:8px 0}.cands{display:flex;flex-wrap:wrap;gap:8px}
.cand{display:inline-flex;flex-direction:column;align-items:center;border:2px solid transparent;border-radius:8px;padding:6px;cursor:pointer}
.cand:has(input:checked){border-color:#2a7}.lab{font-weight:700}
#bar{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:12px;margin:-20px -20px 10px;z-index:9}
button{background:#2a7;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:15px;cursor:pointer}
#count{font-weight:600;margin-right:12px}</style></head><body>
<div id="bar"><span id="count">0 / __N__ answered</span>
<button onclick="download_answers()">Download my answers</button></div>
<p>Pick the item (A–D) that best completes each partial outfit — your own eye, no rules. Answer all __N__, then Download.</p>
__CARDS__
<script>
function tally(){let a=document.querySelectorAll('input[type=radio]:checked').length;
 document.getElementById('count').textContent=a+' / __N__ answered';}
document.addEventListener('change',tally);
function download_answers(){let o={};document.querySelectorAll('.q').forEach(q=>{
 let r=q.querySelector('input[type=radio]:checked');if(r)o[r.name]=r.value;});
 let n=Object.keys(o).length;if(n<__N__ && !confirm(n+' of __N__ answered — download anyway?'))return;
 let b=new Blob([JSON.stringify(o,null,1)],{type:'application/json'});
 let u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='calibration_answers.json';a.click();}
</script></body></html>"""


if __name__ == "__main__":
    main()
