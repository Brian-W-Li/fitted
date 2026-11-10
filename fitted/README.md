# Fitted web app

This is the Next.js interface and authenticated API. [Root setup](../README.md#run-locally) owns environment/build instructions; [the documentation map](../docs/README.md) owns authority and [the roadmap](../docs/ROADMAP.md) owns active work. Do not infer deployment from this checkout's branch name.

The browser reaches authenticated routes, which load owned wardrobe data and call the Python service. Shown generations, reactions, actual wear and planning intent have different storage and semantics; see [the database source map](docs/database.md).

For changes, follow [AGENTS.md](../AGENTS.md). Run web checks from this directory. Production uses the paired web/Python deployment; generic Next.js deployment instructions are not Fitted's release procedure. Source/tests establish behavior and the roadmap distinguishes local, CI and hosted evidence.
