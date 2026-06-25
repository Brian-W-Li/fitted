# Spearhead golden stress corpus (C6)

Forced-item rescue cases that pressure-test the v2 pipeline end-to-end (spearhead.md §E).
Each `*.json` case is loaded by `fitted_core.evaluation.load_corpus_case` into a
`RescueRequest` plus an optional canned generator response. They serve three roles:

1. **Real-eval input** — `python -m fitted_core.cli --closet tests/fixtures/corpus/<case>.json`
   runs the case through a real `OpenAIGenerator` (needs `OPENAI_API_KEY`) and prints the
   mechanical metrics + a believability rubric template (H40).
2. **Hermetic `--dry-run` / regression input** — cases with a `canned_response` replay it
   through a `ReplayGenerator` (no key, no network), so the harness + CLI are testable and
   the corpus doubles as the `StubGenerator` regression fixtures (§E "live findings flow
   back into the hermetic suite").
3. **Failure-attribution targets** — the harness re-runs parse → validate → drop over the
   captured generator output (§E option a) so each case's loss is pinned to a stage.

## Case schema

```jsonc
{
  "case_id": "green_shirt",
  "description": "what this case is and why it exists",
  "stresses": ["the corpus bullets this case exercises"],
  "request": {
    "forced_item_id": "t-green",      // the orphan to rescue (must be in `wardrobe`)
    "occasion": "weekend casual",      // free text; "" gives full occasion credit
    "weather": "mild",                 // hot | mild | cold | indoor | outdoor
    "session_id": "corpus-green-shirt",
    "wardrobe_version": 1
    // optional: generation_index, k, n_surfaced, date
  },
  "wardrobe": [
    {"id": "t-green", "name": "...", "type": "top", "warmth": 4,
     "style_tags": [], "color_tags": ["green"], "occasion_tags": ["casual"],
     "material": "cotton", "formality": "casual"}
    // type ∈ top|bottom|dress|outer_layer|shoes; only id/type/warmth load-bearing,
    // image_url defaults to "<id>.jpg", tags/material/formality optional (CV may omit)
  ],
  "canned_response": {                 // OPTIONAL — the exact GPT envelope to replay.
    "outfits": [ { "items": [{"itemId": "...", "role": "..."}],
                   "styleMove": {"moveType": "...", "changedItemIds": ["..."],
                                 "oneSentence": "..."} } ]
  }
  // omit canned_response for pre-GPT exits (e.g. tiny_insufficient) — no generation occurs.
  // a string canned_response is replayed verbatim (e.g. a deliberately-invalid JSON case).
}
```

`canned_response` is what a `Generator` returns (raw text). It is **not** a believability
oracle — only the strict validator is (§E). Real believability is judged by a human against
the rubric the CLI prints.
