# S1 — useful garment details

Bounded implementation contract, based on GitHub main `169c0ee`. The user authorized building
S1 and releasing it to the existing hosted app after appropriate checks. R23’s
layering contract remains the foundation. Historical research plans are references,
not the current execution queue; no learned head receives a production vote.

The job is to enter or correct pattern/fit and let the stylist use those declared
attributes when choosing owned combinations and explaining a styling move. Optional
bounded values flow through the request, Python prompt and immutable snapshot.
Unknown stays unknown. Names/photos do not generate missing fit measurements.
Colors, occasions and layer role keep their existing behavior. Freeform tags,
material, body measurements, new ranking weights and visual understanding are outside
this sprint. Photos remain for recognition and inspection.

The editor explains the new inputs. Its existing hidden size/notes fields are
preserved on save rather than cleared by a pattern/fit correction.

Acceptance: valid details reach the stylist and persist; missing/malformed legacy
optional details keep the garment usable; edit/clear affects a new request while
saved capture remains unchanged. Existing layering, controls, planning/wear,
ownership and deletion remain valid. Check focused adapter/service/schema/editor
seams, one integrated regression and the compiled browser journey, plus one bounded
live read/generation checkpoint. Report local, CI and hosted evidence separately;
do not claim better personal outfits from a forwarding test or a single suggestion.

Release: reuse the existing Vercel/Fly configuration and ordinary request deadlines.
No data migration, closet rewrite, new test account or production credential export
is needed. Review the source branch against main; use the normal PR/release flow.
Retain the preceding paired release for rollback without deleting new evidence.

Current implementation: optional `pattern` and `fit` fields, bounded normalization,
shared contract clamp, declared-detail prompt and captured metadata; core `0.8.0`,
prompt `style-context-details.v4`. Release checks and their limits are recorded in the S1 pull request. These
implemented input contracts do not by themselves establish personal benefit.
