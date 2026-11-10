# Fitted Python engine and service

The authenticated [service](service/app.py) calls [fitted_core](fitted_core/).
The engine samples owned garments, generates bounded drafts, validates composition,
ranks and diversifies candidates, and captures shown-generation evidence.
[generation.py](fitted_core/generation.py) is the explicit model-SDK/network boundary.
Next.js owns authentication, Mongo queries and persistence; the core owns no database.

[Root setup](../README.md#run-locally), [the documentation map](../docs/README.md),
[the specification](../docs/Fitted_Spec_v2.md) and [the roadmap](../docs/ROADMAP.md)
own setup, authority, design and current execution respectively.
Legacy feedback uses item IDs and exact outfit signatures. Named protocol-v2 requests
also carry owner-resolved context and evidence to [preferences.py](fitted_core/preferences.py)
and [declared relationship features](fitted_core/preference_features.py). The
[selected contract](../docs/plans/personal-styling-loop.md) owns opt-in, partitioning,
abstention and evaluation. The frozen catalog head has no serving vote; synthetic
engineering checks do not establish personal styling benefit.

Run `python -m pytest tests service/tests -q` from this directory. Tests use injected
generators; they do not require paid model calls. The historical rule-based example
is not the production engine.
