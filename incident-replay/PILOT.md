# Pilot protocol for incident replay

Question. Does access to a provider record improve the next decision when an interrupted agent's summary is unreliable?

Use a synthetic stock service and two matched sets of cases. Include original commit, original rollback, unavailable evidence, and an approved quantity that changed during the interruption. Vary surface details and make sure readers cannot infer the outcome from wording, order, or operation identifiers. Have an independent author supply a held-out set, then freeze the scoring and case allocation before the first participant.

Each operator sees both conditions on disjoint matched cases. Counterbalance evidence access and case order. Both views show the same trace, summary, timing and available actions. Only the augmented view can read the provider record. A short walkthrough uses an excluded case. Capture each first decision and its decision-time observations before revealing any ground truth. The portable demonstration ships its answer data and gives immediate feedback. Use a separate study surface with grading data outside the participant view for the actual comparison.

| Case | Evidence at decision time | Scoring rule |
| --- | --- | --- |
| Original commit | Authoritative, matching provider record | Reconcile the original reservation. A fresh write is a duplicate. |
| Original rollback | Authoritative rollback and still-current approval | Retry creates exactly one intended reservation. |
| Lookup unavailable or never read | Outcome unknown | Hold is justified. A new write or a definitive claim lacks evidence. |
| Revised order | Original approval and original receipt | Preserve the original reservation and obtain current approval for any new write. |

Primary measure is the proportion of appropriate next decisions under the evidence available. Report duplicate writes, unwarranted completion claims, avoidable holds and time including reads separately. A lucky retry is unsafe even if it produces the intended row count. A hold stays safe but does not earn resolution credit when an available read could resolve the case. Record whether each person used the available check. Report paired comparisons, per-case counts, uncertainty and all exclusions. Preserve the non-diagnostic cases and any evidence-access implementation failures.

Run a small usability rehearsal before a comparative study. That rehearsal checks instructions, controls, recording and scoring. Obtain separate approval before scheduling, recruiting, collecting participant data or publishing results. The checked cases in this demo are authored and synthetic. Human performance remains to be measured.
