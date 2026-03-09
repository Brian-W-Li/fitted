# Date of Retrospective: 03/06/26

* Led by: Pengyu Chen
* Present: matthew, jenil, animesh, pengyu, brian
* Absent: N/A

## Action item

* a goal: Finish final submission readiness by stabilizing prompt quality and polishing UI/UX before code freeze.
* a change/experiment: Move to a final-pass workflow: every remaining issue must include acceptance checks and be validated by one teammate before Done.
* a measurement: Number of remaining prompt/UI tickets closed, number of acceptance checks passed, and zero critical regressions in final demo paths.

## Start, Stop, Continue
#### Start
- Start doing a focused final QA pass on end-to-end user flows (sign in, wardrobe add/edit, recommendation, feedback).
- Start using concrete prompt test cases (same input set) so we can compare output quality consistently.

#### Stop
- Stop introducing new non-essential features this late in the cycle.
- Stop making unreviewed UI tweaks right before merge.

#### Continue
- Continue fast communication in group chat for blockers and merge coordination.
- Continue splitting work into clear, testable tickets with owner and acceptance criteria.

## Retro Assessment

Retro process used: We used the same structured format from previous retros (goal + experiment + measurement, then start/stop/continue) and each member gave short updates on what is left for final delivery.

Assessment of how it went: The retro was focused and practical. We aligned that most core functionality is complete, and the remaining work is mainly prompt quality and UI polish. Team consensus was strong on reducing scope and prioritizing stability.

Advice for the next retro lead: Since this is the final retrospective for this cycle, keep discussion tightly tied to submission readiness, demo reliability, and risk mitigation rather than new feature ideation.

## Experiment/Change

* We want to require acceptance checks and one teammate validation before marking final tickets as Done.
* Assessment of results: This reduced merge confusion and caught small regressions earlier, especially on shared UI and API touchpoints. It also improved confidence in final branches.
* Decision going forward: Keep this lightweight validation rule through final submission and apply it as a default team habit in future sprints.

## Individual Start, Stop, Continue Reflections

#### Matthew
- Start: Testing the ML throughly and checking for edge cases
- Stop: Trying to implement features that are too difficult or complex
- Continue: Communicating with teammates consistently 

#### Animesh
- Start: Looking for edge cases so we dont have to redo the entire app in 1 week
- Stop: Procrastinating work the closer I get to finishing
- Continue: Being awesome

#### Jenil
- Start: working after giving up after the initial ML part didnt work, find out what key additions can be done onto the current project
- Stop: being distracted by other applications online to implement what the team has for now, finishing the code till the code freeze is the priority
- Continue: playing around with what teammates are doing to find errors

#### Brian
- Start: Focus more on documentation than pushing forward with more complex features
- Stop: Brainstorming features that are too complex
- Continue: Implement ideas that have already been floating around like visual outfit displays

#### Pengyu
- Start: Start completing final UI polish and prompt-related feedback fixes with clear acceptance tests.
- Stop: Stop opening new scope beyond required submission goals.
- Continue: Continue implementing and testing assigned issues quickly with team communication.
