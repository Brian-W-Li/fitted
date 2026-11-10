# Fitted Python engine and service

The authenticated [service](service/app.py) calls [fitted_core](fitted_core/).
The engine samples owned garments, generates bounded drafts, validates composition,
ranks and diversifies candidates, and captures shown-generation evidence.
[generation.py](fitted_core/generation.py) is the explicit model-SDK/network boundary.
Next.js owns authentication, Mongo queries and persistence; the core owns no database.

[Root setup](../README.md#run-locally), [the documentation map](../docs/README.md),
[the specification](../docs/Fitted_Spec_v2.md) and [the roadmap](../docs/ROADMAP.md)
own setup, authority, design and current execution respectively.
Existing feedback uses item IDs and exact outfit signatures. A trained head has no
production vote; the selected learning contract remains development work.

Run `python -m pytest tests service/tests -q` from this directory. Tests use injected
generators; they do not require paid model calls. The historical rule-based example
is not the production engine.
