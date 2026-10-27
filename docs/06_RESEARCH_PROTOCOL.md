# Research protocol: immediate unaided recovery after recorded agent work

Status: **design specification; no study approved, launched, or completed**.

The study owner makes the eventual research decision. Coding agents implement and verify the instrument. They must not recruit, purchase participants, claim ethics approval, invent observations, or publish human-performance findings.

## 1. What this study can establish

The study asks whether adding one pre-commitment scaffold to a fixed agent-work sequence changes people's ability to repair the resulting system after assistance ends. The outcome is **immediate unaided operational recovery in this environment**.

The primary comparison has exactly two arms:

1. **Time-matched delegation:** observe the recorded agent's work, with fixed observation windows and normal factual explanations.
2. **Delegation plus pre-commitment:** see the same work and information, and record one's own proposed next action before the recorded agent recommendation appears.

The intended primary estimand is the intention-to-treat absolute difference in the probability of a valid repair received on or before the 300-second deadline. Participant assignment, rather than whether somebody complied with every prompt, determines the analysis arm.

A positive result would support this specific assistance policy, population, task, and exposure budget. It would not establish lasting learning, prevention of deskilling, competent professional operation, a reduction in enterprise incidents, or the general superiority of human oversight. A null result is not proof of equivalence. A two-arm experiment does not identify the effect of AI access itself because both arms see agent work.

## 2. Prior work and the specific contribution

Classic automation research already discusses the difficulty of returning control to people: [Bainbridge, 1983](https://doi.org/10.1016/0005-1098(83)90046-8). [Simkute and colleagues](https://arxiv.org/html/2402.11364v1) explicitly connect that lineage to generative AI. The task is not the invention of the takeover paradigm.

[Mitchell, Ghosh and Passi](https://arxiv.org/html/2608.23642v3) name pre-commitment, action gating, and batch review in an inventory of oversight-support mechanisms. Their paper is a position paper and references earlier designs. Its retrieved v3 does not justify calling these mechanisms previously untested inventions. [Buçinca, Malaya and Gajos](https://arxiv.org/abs/2102.09692) already experimentally studied cognitive forcing and its tradeoffs.

[Anthropic's coding study](https://www.anthropic.com/research/AI-assistance-coding-skills) randomized AI access, but its associations between interaction styles and learning were explicitly noncausal. Its immediate assessment does not settle long-term outcomes.

[Maier and colleagues, 2609.20143](https://arxiv.org/abs/2609.20143) is a relevant preregistered N=704 study of metacognitive feedback and offloading. The primary indexed record was available; direct abstract, PDF, and HTML retrieval failed during preparation of this pack. The full methods and results were not independently verified here, and its effect size is not a power assumption for this project.

The proposed contribution is a reproducible tool-using environment, an inspectable stateful recovery outcome verified on fresh inputs, and an explicit comparison of one assistance design. The existence of a paper-worthy empirical contribution depends on the resulting study and fuller related-work assessment.

## 3. Public play, local usability, and research are separate modes

| Mode | Purpose | Collection and inference |
|---|---|---|
| Public playground | A short, replayable experience | No application-level research collection or participant enrollment; no research conclusions from visitor activity |
| Local usability | Find confusing controls and broken workflows | Owner-initiated local export may record consented usability sessions; marked `local_usability`; not accepted into the confirmatory dataset |
| Research | The preregistered controlled experiment | Requires the launch gate, a server-authoritative collector, consent, immutable assignment, and complete provenance |

Public play can permit repeated attempts, assistance replay, and shorter presentation pacing. Research does not inherit those freedoms. A public-demo score is not a study observation.

Hosting providers may retain ordinary access logs; an application claim of no research collection must not imply that hosting creates no network metadata. Review that separately before research deployment.

## 4. Participant journey

The first confirmatory version uses consenting adults who meet the declared recruitment criteria. Intended eligibility includes age 18 or over, ability to understand the English instructions, and a supported desktop/laptop browser with a working pointer or keyboard. Audio must not be required to solve the task. These choices restrict the study population and must be reported.

The sequence is:

1. Information and consent, including accurate disclosure that agent actions are recorded and assistance later ends.
2. Technical readiness check and a brief common mechanics tutorial.
3. A short common baseline task for familiarity/skill characterization, with fixed instructions. Do not use the future repair fault or reveal its answer.
4. Random assignment, issued only when the participant is ready to begin the fixed exposure.
5. The assigned presentation of the common recorded construction trace.
6. A common handover, followed by the first designated fault and a 300-second repair window.
7. Brief effort/experience questions and debrief, with compensation independent of repair success.

An optional transfer task belongs after the primary episode and has a separately labeled outcome. A later-session retention experiment is outside this protocol. Estimated total paid participation is 30 minutes for budgeting, with a 45-minute sensitivity scenario; pilot actual duration determines the final advertised estimate and payment.

## 5. The one scaffold: pre-commitment

Three decision windows occur at predetermined trace event indices. At each, the treatment participant records the action they think should happen next, before seeing the recorded agent recommendation. This is a nonbinding judgment: it neither selects the agent action nor changes the system.

The control participant sees the same current state, objective, and action alternatives, with the same opportunity to inspect. They are not required to record a choice. The request to commit, including its effect on attention, is the treatment.

Include an `unsure` option. At the deadline, a missing response is recorded as missing scaffold participation and the sequence advances. Never require a correct response to continue. Never give extra explanation, extra time, or another training attempt only to people who answered incorrectly. The intervention must not become a hidden personalized tutor.

Provisional timing is **25 seconds before reveal and 20 seconds after reveal at each of three windows**, in both arms. These are design values to calibrate during usability work, not established cognitive constants. The research release uses a frozen protocol version and cannot change them mid-study.

The post-reveal recommendation, executed action, resulting state, action diff, and factual explanation are identical. The control is therefore ordinary delegation with deliberately matched observation windows; it is not unrestricted naturalistic delegation. Report that limitation.

## 6. Match actual payloads, not approximate descriptions

Create one immutable scenario manifest for each study scenario. It contains the tutorial reference, action alternatives, trace identifier, event indices of the three windows, the exact factual cards shown before and after each reveal, common reference material, fault specification, and exposure schedule.

The two arm renderers must consume this same factual manifest. Arm-specific code may add the pre-commitment response interaction and its neutral instruction, but may not substitute, simplify, expand, reorder, or conceal factual content.

Machine checks must establish:

- The factual-payload digest is identical between arms for every scenario and window.
- Recommendations remain unrevealed until the same scheduled time in both arms, including accessible labels and hidden DOM content.
- The identical trace actions execute in identical order, regardless of response, response correctness, or lack of response.
- The allotted before/after durations and common reference access are identical.
- Both arms reach the same canonical inherited-state hash for the same scenario seed.
- The fault manifest, repair controls, diagnostics, deadline, and evaluator version are identical.
- Refresh, navigation, retries, tab visibility changes, and interrupted connections cannot silently reset timing or reassign the arm.

Identical allocated time does not guarantee identical human attention. Record actual presentation timing and visibility deviations, and report adherence rather than claiming attention was equal.

## 7. Recorded agent provenance

The study uses a genuine recorded agent execution through the shared typed tool surface. Model/provider identity, model version as exposed by the provider, recording date, prompts/configuration, tool schema version, engine version, trace digest, and relevant request settings accompany the trace. If a provider does not expose a property, record its absence explicitly rather than inventing it.

The recorded actions execute in the live deterministic engine. The study interface states that this is a recording; it must not simulate a nonexistent live conversation. Any edited narrative is distinguished from verbatim model output, and no fabricated tool actions are labeled real.

No live model API receives participant interactions during the research experiment. Live-agent development and demonstrations are separate modes, with separate credentials and budgets.

## 8. Primary recovery episode and oracle

The primary episode is the first designated recovery episode. Assistance handover occurs at settled logical tick 5, with the plant paused and inherited jobs due at tick 6 still pending. This gives the participant a meaningful opportunity to inspect the inherited state. Step, Run and Pause are available equally in both arms. Pausing does not stop the 300-second human deadline. Logical engine time is independent of browser animation frames and rendering speed.

Keep assistance handover separate from the evaluation continuation boundary. The session's assistance-handover tick is 5 in this first scenario. An evaluation case's `handover_tick` means the submitted candidate's current settled logical tick, which may be later after Step or Run. Every continuation for that candidate uses the same boundary and authoritative history through it. Earlier incorrect outputs remain recorded as secondary outcomes; the primary scorer tests valid behavior after the submitted repair and does not claim that earlier harm was undone.

The participant starts from the assigned common inherited state plus the common injected fault. They can use the same built-in mechanics reference and inspection controls in both arms. “Unaided” means no further agent recommendation, worked repair answer, treatment prompts, or external assistance within the protocol; reference access is explicitly allowed. The estimand concerns recovery in this pausable toy system; it does not establish takeover competence in an unpausable real-time operation.

The participant has **300 seconds and one primary submission** to submit a candidate repair. In deployed research, the server authoritatively issues the recovery start/deadline and records command/submission receipts. A candidate received by the server on or before the deadline is eligible even if scoring completes later. A late candidate does not become timely because its browser timestamp claims otherwise. Admission atomically freezes the candidate, closes interaction for this primary episode, and rejects later mutations or new candidate submissions. Idempotent retransmission can recover the original receipt but cannot create another attempt.

The frozen evaluator starts from the immutable current candidate snapshot, retaining pending valid jobs and other dynamic state, and checks its behavior under the specified fresh seeded environment inputs. It must not replace the candidate with a clean reset or silently remove pending work. A screenshot, graph shape, participant explanation, or model judgment is not a repair oracle. A repair must preserve the target behavior and pass the required independent checks. The evaluator's seed bank and acceptance semantics are versioned before data collection.

Reveal the evaluator result only after the primary episode is closed. There is no ongoing hidden-test feedback during repair and no opportunity to resubmit after a failed primary check. Research must not expose held-out seeds, hidden fault answers, or detailed oracle diagnostics before that closure. Scoring must not mutate the live state or consume its random stream. A later public-practice attempt or exploratory episode is separate and cannot change the recorded primary outcome.

The one timely submitted candidate establishes primary success only if it passes the frozen evaluator. An observed invalid primary repair, a deadline without submission, or a validly recorded voluntary task stop establishes primary success of zero. Do not replace that zero with the result of a later successful attempt. Invalid captures, corrupt logs, and infrastructure incidents are separately coded rather than attributed to poor human understanding.

## 9. Data and measurement contract

The collector must retain enough evidence to reconstruct assignment, exposure, system state, and timely candidate admission. Required concepts include:

- Pseudonymous research participant/session identifiers, consent version, protocol version, and assignment receipt.
- Scenario/trace/engine/tool-schema/evaluator identifiers and immutable digests.
- Arm, actual exposure-window starts/reveals/ends, factual-payload digests, response availability and pre-commitment choices where applicable.
- Recovery start and deadline, sequenced typed actions, authoritative receipts, state hashes, candidate digests, evaluator results, and phase transitions.
- Completion, voluntary task stop, consent withdrawal, technical incident, and unknown outcome as separate states.
- Minimal browser/runtime compatibility fields and visibility/connectivity events needed to interpret technical issues.

Do not collect names, email, webcam/audio, screen recording, free-form personal information, unrelated browsing, or device fingerprinting as part of this protocol. Do not log payment/recruitment IDs in public exports. If an external recruitment identifier is needed, keep the linkage separately with access controls.

Participant actions are the behavioral record; ticks, mouse movements, oracle seeds and repeated scorer calls are not additional independent observations.

## 10. Statistical analysis plan

### Primary analysis

Analyze by assigned arm. Wrong or skipped pre-commitment choices do not justify exclusion or reassignment. The primary unit is one randomized participant and the primary outcome is timely valid repair in the first episode. The analysis input contains one adjudicated primary outcome per participant, not one row per check or per later practice attempt; the collector verifies this before generating the summary document.

With complete primary outcomes, report each arm's success proportion, the treatment-minus-control risk difference in percentage points, and a two-sided 95% Newcombe interval built from Wilson score intervals for the two independent proportions. The preregistered primary test is the two-sided pooled two-proportion score test at alpha .05. Handle zero pooled variance explicitly; do not produce a divide-by-zero result. Do not infer a mechanism from a significant difference.

The simple test assumes the declared independent parallel-arm design. If the final allocation or planned analysis becomes stratified/clustered, update the protocol and simulate the exact planned test's power before preregistration. Do not change the test after inspecting outcomes.

### Technical missingness and voluntary failure

No repair, an invalid repair, expiration of the window, or choosing to end the task with valid records is an observed failure. A backend outage, a corrupt authoritative record, or an indeterminate phase/deadline can make an outcome technically unknown. Neither category is silently discarded.

Retain all randomized participants in the disposition table. If technically unknown outcomes remain, a single assumption-free ITT point estimate is not identified. Report the observed-record estimate as descriptive and produce a conservative primary sensitivity envelope: assign all unknown treatment outcomes to failure/control to success for the lower extreme, reverse those assignments for the upper extreme, and report the outer limits of the corresponding 95% risk-difference intervals. A directional confirmatory conclusion requires this envelope to support the direction; otherwise label it inconclusive. Do not relabel the complete-case estimate as ITT.

Consent withdrawal and mandatory deletion follow the consent/review determination, even when that limits analysis. Preserve only the disposition information permitted by that determination. No statistical objective overrides a participant's withdrawal rights.

Document incidents and adjudicate technical-invalidity codes without viewing treatment effects. Recruitment replacement decisions must follow the frozen stopping rule; they cannot depend on which arm is winning.

### Secondary outcomes

- Time to the one timely valid primary submission: the result is known after scoring, but the event time is its admission receipt. Do not report only successful participants' mean as overall speed. A deadline without submission is administratively censored at 300 seconds; early terminal unsuccessful submission/voluntary stop is an unsuccessful competing terminal event, not a later success or an ordinary independent censoring event. Report these separately and avoid a naive Kaplan–Meier claim that assumes those people remained equally able to submit successfully after their episode ended.
- Unnecessary or disruptive changes: use predefined observable categories, not retrospective model labeling of participant competence.
- Rejection of the primary candidate by fresh-input checks, submission versus no submission, and meaningful inspection actions. A primary submission count above one is an instrument defect, not extra participant evidence.
- Effort and willingness to use the interface, acknowledging that these do not measure objective recovery skill.
- Optional transfer: separate episode labels, fresh task mechanisms/combinations and participant-clustered analysis. Renaming components alone is weak transfer.

Secondary and exploratory analyses are clearly labeled. Do not promote a favorable subgroup, transfer episode, or alternative endpoint to replace the primary outcome. Correction for any planned multiple confirmatory claims must be specified before collection.

## 11. Power and sample size

Do not hardcode “130 is enough.” Binary-outcome planning requires a control probability, target probability, alpha, power, test, and allocation. The pack's power calculator provides transparent scenario calculations; a later exact-test or stratified design requires appropriate simulation.

For equal arms, a normal approximation with two-sided alpha .05, 80% power, and no continuity correction gives:

| Control success | Treatment success | Difference | Analyzed per arm | Total analyzed |
|---:|---:|---:|---:|---:|
| 50% | 60% | 10 points | 388 | 776 |
| 50% | 65% | 15 points | 170 | 340 |
| 50% | 70% | 20 points | 93 | 186 |
| 50% | 75% | 25 points | 58 | 116 |
| 40% | 60% | 20 points | 97 | 194 |

These are computed planning scenarios, not expected effects or guaranteed exact sample sizes. With N130, approximate power is only 65% for 50% versus 70% and 41% for 50% versus 65%.

Use **200 analyzed participants and 224 recruits as a provisional budgeting scenario** for a relatively large 20-point difference and a 10% unusable-record allowance. These are not permission to launch or a final stopping rule. The chosen smallest worthwhile effect, baseline range, exact test and missingness assumptions must be justified before confirming the recruitment target. Genuine observed failures always remain outcomes; they are not “unusable records.”

## 12. Pilot, freeze, and verification

A consented usability pilot of 5–10 people can expose confusing controls and timing faults. It is too small to yield a dependable effect-size estimate. Use it to assess difficulty, ceiling/floor problems, actual duration and exposure integrity. Do not select a confirmatory sample from its most favorable treatment effect.

Before confirmatory collection, the study owner freezes the protocol, recruitment criteria, consent, trace, scenarios, intervention content/timing, primary endpoint, evaluator, assignment procedure, missingness handling, analysis code, sample target and stopping rule. Record their digests with the study release.

Implementation acceptance includes synthetic datasets with known success counts, complete failure, all success, imbalanced completion, technical missingness and duplicated submissions. It also includes two-arm payload equivalence, trace/state equivalence, deadline boundary cases, clock tampering, interrupted sessions, and scorer isolation. Passing those tests verifies the instrument's specified behavior; it does not provide human evidence.

If the study is never launched, ship the instrument and its engineering verification honestly. Do not fill a results page with synthetic participants, model-generated people, public visitors, or pilot outcomes presented as confirmatory findings.
