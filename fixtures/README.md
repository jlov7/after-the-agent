# Fixture semantics

`golden.json` holds ten independently hand-worked input/output examples. Each vector is a separate task example; do not combine different initial histories or candidate boundaries into one evaluation suite.

`continuation-policy.json` freezes twelve future-pattern templates. `continuations.json` instantiates them for a candidate at tick 5 with an active blue scene and no prior transitions. It is a headless engineering corpus, not a substitute for the authoritative history of another candidate. The production adapter preserves the submitted candidate's entire world prefix and materializes each future suffix relative to that candidate's current settled tick.

None of these files is a genuine agent recording, participant observation or empirical result. They are executable specification inputs. The application must generate observed outputs independently, rather than copying expected values into an alleged engine trace.
