"""Step-2 tooling: build the human-agreement calibration set (§8 / §F / build-doc calibration spec).

The judge envelope (prompt / K / determinism) is tuned to best match a **diverse human panel's**
forced-choice compatibility judgments on a held-out set — a **human label on purpose**, disjoint from
every gated question. This module: (1) draws N FITB questions from the **valid + train** splits,
**stratified by garment category** (automatically disjoint from the test-only gate-B/gate-D sets — the §F
blindness guarantee — and covering types evenly), keeping only **5-type-coherent** questions
(`coherence.fitb_question_is_coherent` — Polyvore sets are shopping boards; ~13% imply a wear-impossible
outfit humans balk at labeling; §F amendment 2026-07-01) whose items also pass the committed
**visual-QC exclude list** (`calibration_visual_qc.json` — source-corrupted parquet images, e.g. an
item whose "trousers" image is a car; the mechanical rule cannot see pixels), (2) exports a
**self-contained HTML viewer** (garment photos + A–D radios + a "Not sure" abstain option + a
"download my answers" button — the image-only modality that matches the headline judge), and
(3) aggregates every panelist's downloaded answers by unique-plurality consensus over confident
(non-skip) votes into the committed `calibration_set.json` (the `evaluate.py` unlock binds it by sha and
asserts its `question_ids` touch no gated question). The EVAL sets are NOT filtered — they stay the
standard benchmark; `evaluate.py` reports coherence-sliced sensitivities instead (§F / build doc §12).

Workflow (after the Step-1 cache/training run frees the parquet):
    .venv/bin/python make_calibration.py            # writes calibration_viewer.html — send to every panelist
    # each panelist: open it, pick A/B/C/D (or "Not sure" — never guess), click "Download my answers";
    # collect the downloads renamed per person (alice.json / bob.json / me.json), then:
    .venv/bin/python -c "import make_calibration as m; m.finalize_panel(['alice.json','bob.json','me.json'])"

Reference: docs/plans/h26-compatibility-spike-v2.md §8 / preregistration.md §F.
"""

from __future__ import annotations

import html
import json
import os
from collections import Counter

from coherence import fitb_question_is_coherent
from data_loader import Corpus, FitbQuestion, build_fitb, load_headline_corpus, load_json_strict
from gpt_judge import CHOICE_LABELS

ROOT_DIR = os.path.dirname(__file__)
CALIB_SEED = 424242          # distinct from the headline seed 20260629 (a separate draw)
CALIB_SIZE = 100             # RAW draw; skips + no-consensus drops leave the SURVIVING set (floored >=50, §F)
MIN_CONFIDENT_VOTES = 2      # a kept question needs >= this many confident (non-skip) votes AND a unique plurality
SKIP = "SKIP"                # viewer value for "not sure / outside my competence" — abstain, NEVER guess (§F panel)
SURVIVOR_FLOOR = 50          # §F: the post-drop consensus set must still clear the size floor
VIEWER = os.path.join(ROOT_DIR, "calibration_viewer.html")
QUESTIONS_CACHE = os.path.join(ROOT_DIR, "calibration_questions.json")  # the drawn questions (regenerable)
VISUAL_QC = os.path.join(ROOT_DIR, "calibration_visual_qc.json")        # committed operator image-QC exclude list


def load_visual_qc_excluded(path: str = VISUAL_QC) -> set[str]:
    """Item ids whose SOURCE image is not a photo of the garment its metadata declares (operator visual
    QC over the drawn questions — e.g. 166938043, 'rick owens trousers' whose parquet image is a car).
    A calibration question touching any excluded item (retained OR candidate — a junk distractor breaks
    the human forced choice too) is skipped by the draw. The committed artifact makes the redraw
    reproducible: draw -> operator views every image -> junk item ids land here with a reason -> redraw.
    Missing file = empty list (the draw is then filter-only)."""
    if not os.path.exists(path):
        return set()
    doc = load_json_strict(path)
    return {row["item_id"] for row in doc["excluded_items"]}


def build_calibration_questions(
    corpus: Corpus, *, n: int = CALIB_SIZE, seed: int = CALIB_SEED,
    excluded_items: set[str] | None = None,
) -> list[FitbQuestion]:
    """Draw `n` FITB questions from valid + train (NEVER test — the gate-B/gate-D sets are test-only, so
    valid/train questions are disjoint by construction, §F). Deterministic from `seed`; one question per
    distinct outfit. Two pre-draw filters (§F amendment 2026-07-01, pre-pilot):
    **5-type coherence** (`coherence.fitb_question_is_coherent` — the panel labels only wearable-outfit
    questions; the strict rule + its disclosed layered-top over-flagging live in `coherence.py`) and the
    **visual-QC exclude list** (`excluded_items`, default the committed `calibration_visual_qc.json` —
    a question touching any source-corrupted image is skipped). **Stratified by `answer_category`**
    (round-robin across the category of the item being completed) so the set covers garment types evenly
    instead of following the raw draw's skew — the judge envelope is then selected against a
    representative slice, not a lopsided one (§F 'cover more ground'). `build_fitb` shuffles within a
    split; we pool valid-then-train, bucket by category preserving that shuffled order, then round-robin
    one-per-category until `n` are taken."""
    excluded = load_visual_qc_excluded() if excluded_items is None else excluded_items
    pool: list[FitbQuestion] = []
    for split in ("valid", "train"):
        qs, _ = build_fitb(corpus.splits[split], corpus.item_index, seed)
        pool.extend(
            q for q in qs
            if fitb_question_is_coherent(q, corpus.item_index)
            and excluded.isdisjoint((*q.retained, *q.candidates))
        )
    buckets: dict[str, list[FitbQuestion]] = {}
    for q in pool:                                  # keeps build_fitb's shuffled order within each bucket
        buckets.setdefault(q.answer_category, []).append(q)
    ordered_cats = sorted(buckets)                  # deterministic category order (stable across runs)
    cursor = {c: 0 for c in ordered_cats}
    picked: list[FitbQuestion] = []
    while len(picked) < n:
        made_progress = False
        for c in ordered_cats:                      # one question per category per round -> balanced coverage
            if cursor[c] < len(buckets[c]):
                picked.append(buckets[c][cursor[c]])
                cursor[c] += 1
                made_progress = True
                if len(picked) >= n:
                    break
        if not made_progress:                       # pool exhausted before n
            break
    if len(picked) < n:
        raise ValueError(f"only {len(picked)} calibration questions available across "
                         f"{len(ordered_cats)} categories, need {n}")
    return picked[:n]


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
        cand_rows.append(                             # abstain, never guess (§F panel — women's-outfit competence gap)
            f'<label class="cand skip"><input type="radio" name="{html.escape(q.set_id)}" value="{SKIP}">'
            f'<span class="lab">Not&nbsp;sure</span></label>'
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


def _confident_index(label: str | None, n_candidates: int) -> int | None:
    """Map one labeler's raw pick to a 0-based candidate index, or None for an ABSTENTION (SKIP / absent /
    blank / out-of-range / unparseable). A confident vote must be a valid in-range A–D label — a skip is
    never a guess, so it simply drops out of the tally (§F panel)."""
    if label is None:
        return None
    s = str(label).strip().upper()
    if s in ("", SKIP):
        return None
    idx = {lab: i for i, lab in enumerate(CHOICE_LABELS)}.get(s)
    if idx is None or idx >= n_candidates:
        return None
    return idx


def _plurality(indices: list[int]) -> int | None:
    """The unique most-voted index, or None on a tie for the top (no clear human consensus -> dropped)."""
    if not indices:
        return None
    ranked = Counter(indices).most_common()
    if len(ranked) >= 2 and ranked[0][1] == ranked[1][1]:
        return None
    return ranked[0][0]


def _skip_rate(answers: dict[str, str], questions: list[FitbQuestion]) -> float:
    """Fraction of questions this labeler abstained on (SKIP/absent) — reported, never penalized (§F)."""
    if not questions:
        return 0.0
    skipped = sum(1 for q in questions if _confident_index(answers.get(q.set_id), len(q.candidates)) is None)
    return round(skipped / len(questions), 3)


def inter_annotator_agreement(per_labeler: dict[str, dict[str, str]], questions: list[FitbQuestion]) -> float:
    """The human ceiling (§F): average PAIRWISE agreement — over every (labeler_i, labeler_j, question)
    where BOTH cast a confident (non-skip) vote, the fraction whose picks match. Abstention-robust, unlike
    Fleiss' kappa (which assumes a fixed rater count per item — broken by per-question skips). Chance is
    25% for a 4-way FITB. The judge can't be expected to track humans better than humans track each other,
    so this bounds what a 'good' judge-agreement number even means."""
    labeler_ids = sorted(per_labeler)
    matches = pairs = 0
    for q in questions:
        confident = [
            idx for lid in labeler_ids
            if (idx := _confident_index(per_labeler[lid].get(q.set_id), len(q.candidates))) is not None
        ]
        for a in range(len(confident)):
            for b in range(a + 1, len(confident)):
                pairs += 1
                if confident[a] == confident[b]:
                    matches += 1
    return matches / pairs if pairs else 0.0


def assemble_panel(questions: list[FitbQuestion], per_labeler: dict[str, dict[str, str]]) -> dict:
    """Aggregate N labelers' picks into the panel `calibration_set.json` (§F panel). Per question: gather
    the CONFIDENT (non-skip) votes; keep it iff >= MIN_CONFIDENT_VOTES confident votes AND a unique
    plurality winner — that winner is the consensus `human_choice`. Questions failing either test are
    DROPPED and COUNTED (the disclosed human-disagreement signal). The surviving `question_ids` +
    `human_choice` are the exact contract the single-annotator set exposed, so the pilot + the evaluate.py
    unlock are unchanged; only the provenance (panel size, agreement, drops, skip rates) is new."""
    labeler_ids = sorted(per_labeler)
    if len(labeler_ids) < 3:
        raise ValueError(f"panel needs >= 3 labelers (§F), got {len(labeler_ids)}: {labeler_ids}")
    survivors: list[dict] = []
    dropped_few = dropped_tie = 0
    for q in questions:
        votes = [
            idx for lid in labeler_ids
            if (idx := _confident_index(per_labeler[lid].get(q.set_id), len(q.candidates))) is not None
        ]
        if len(votes) < MIN_CONFIDENT_VOTES:
            dropped_few += 1
            continue
        winner = _plurality(votes)
        if winner is None:
            dropped_tie += 1
            continue
        rec = _question_record(q)
        rec["human_choice"] = winner            # 0-based consensus index — the judge-selection target
        rec["n_confident"] = len(votes)
        survivors.append(rec)
    if len(survivors) < SURVIVOR_FLOOR:
        raise ValueError(
            f"only {len(survivors)} questions reached panel consensus (need >= {SURVIVOR_FLOOR}, the §F "
            f"floor); recruit more/broader labelers or draw more questions (dropped: {dropped_few} with "
            f"<{MIN_CONFIDENT_VOTES} confident votes, {dropped_tie} tied)"
        )
    return {
        "_README": (
            "Human-agreement calibration set (§F): a diverse PANEL's forced-choice picks on valid/train "
            "Polyvore FITB questions, image-only, aggregated by unique-plurality consensus over confident "
            "(non-skip) votes. question_ids feed the evaluate.py unlock disjointness check; human_choice "
            "(0-based consensus index) is the judge-selection target. NOT Polyvore co-occurrence ground "
            "truth. Judge-envelope selection only; never scores the trained head."
        ),
        "spike": "h26",
        "seed": CALIB_SEED,
        "source": "polyvore_valid_train_image_only_panel",
        "single_annotator": False,
        "n_annotators": len(labeler_ids),
        "consensus_rule": f"unique_plurality_over_confident_votes_min{MIN_CONFIDENT_VOTES}",
        "min_confident_votes": MIN_CONFIDENT_VOTES,
        "inter_annotator_agreement": inter_annotator_agreement(per_labeler, questions),
        "dropped_no_consensus": dropped_few + dropped_tie,
        "dropped_detail": {"too_few_confident": dropped_few, "tie": dropped_tie},
        "per_labeler_skip_rate": {lid: _skip_rate(per_labeler[lid], questions) for lid in labeler_ids},
        "question_ids": [r["set_id"] for r in survivors],
        "questions": survivors,
    }


def finalize_panel(answer_paths: list[str], *, root_dir: str = ROOT_DIR) -> str:
    """Aggregate the panel's downloaded answer files into `calibration_set.json`. Each path is one
    labeler's `{set_id: 'A'..|'SKIP'}` download; the labeler id is the filename stem — so rename each
    person's download (e.g. alice.json / bob.json / me.json) before collecting them here. Run after every
    panelist labels the SAME calibration_viewer.html."""
    cache = json.load(open(os.path.join(root_dir, "calibration_questions.json"), encoding="utf-8"))
    questions = [
        FitbQuestion(r["set_id"], tuple(r["retained"]), tuple(r["candidates"]), r["correct_index"], r["answer_category"])
        for r in cache["questions"]
    ]
    per_labeler = {
        os.path.splitext(os.path.basename(p))[0]: json.load(open(p, encoding="utf-8")) for p in answer_paths
    }
    manifest = assemble_panel(questions, per_labeler)
    out = os.path.join(root_dir, "calibration_set.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    d = manifest["dropped_detail"]
    print(f"[calibration] wrote {out}: {len(manifest['question_ids'])} consensus questions from "
          f"{manifest['n_annotators']} labelers "
          f"({manifest['dropped_no_consensus']} dropped: {d['too_few_confident']} thin, {d['tie']} tied)")
    print(f"[calibration] inter-annotator agreement (human ceiling): "
          f"{manifest['inter_annotator_agreement']:.1%} (chance 25%) -> write into judge_addendum.md "
          f"calibration_set.inter_annotator_agreement")
    print(f"[calibration] per-labeler skip rate: {manifest['per_labeler_skip_rate']}")
    return out


def main() -> None:
    """Draw the calibration questions + export the panel viewer (reads the gated parquet via the resumable
    cached fetch — run AFTER the Step-1 cache build so it does not contend)."""
    from live_content import ParquetContentProvider

    corpus = load_headline_corpus(verbose=False)
    questions = build_calibration_questions(corpus)
    item_ids = {i for q in questions for i in (*q.retained, *q.candidates)}
    provider = ParquetContentProvider(item_ids)
    path = export_viewer(questions, provider)
    print(f"[calibration] wrote {path} ({len(questions)} questions) — send this ONE file to every panelist.")
    print("[calibration] each: open it, pick A–D (or 'Not sure' — never guess), 'Download my answers'.")
    print("[calibration] collect the downloads renamed per person, then:")
    print('[calibration]   python -c "import make_calibration as m; '
          "m.finalize_panel(['alice.json','bob.json','me.json'])\"")


_VIEWER_TEMPLATE = """<!doctype html><html><head><meta charset="utf-8">
<title>Fitted — calibration judgments</title><style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:20px;background:#fafafa}
.q{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}
.qn{color:#888;font-size:12px}.ask{margin:10px 0 6px;font-weight:600}
.thumb{height:120px;width:120px;object-fit:cover;border-radius:6px;margin:4px;vertical-align:middle;border:1px solid #eee}
.partial{margin:8px 0}.cands{display:flex;flex-wrap:wrap;gap:8px}
.cand{display:inline-flex;flex-direction:column;align-items:center;border:2px solid transparent;border-radius:8px;padding:6px;cursor:pointer}
.cand:has(input:checked){border-color:#2a7}.lab{font-weight:700}
.cand.skip{opacity:.75;font-size:13px;align-self:center}.cand.skip:has(input:checked){border-color:#a55}.cand.skip .lab{color:#a55}
#bar{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:12px;margin:-20px -20px 10px;z-index:9}
button{background:#2a7;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:15px;cursor:pointer}
#count{font-weight:600;margin-right:12px}</style></head><body>
<div id="bar"><span id="count">0 / __N__ answered</span>
<button onclick="download_answers()">Download my answers</button></div>
<p>Pick the item (A–D) that best completes each partial outfit — your own eye, no rules. If you can't
confidently judge one (not your area), pick <b>Not&nbsp;sure</b> instead of guessing. Decide all __N__
(a pick or Not sure), then Download.</p>
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
