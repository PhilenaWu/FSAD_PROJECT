# AI reflection — Mahdiya

## What I used AI for

My share of the build was UC-007 (computer-vision defect detection) and UC-013 (paper-form OCR prefill for inspectors), plus a full UI/UX redesign across the whole app, and later a UC-003 extension letting residents edit their own report within 30 minutes of filing. I used Claude Code throughout — to train and evaluate the CV model, debug live issues, decide UX tradeoffs, write tests, and resolve a messy git merge with a teammate's work. For the redesign, I also used ChatGPT earlier in the pipeline, before Claude was involved.

## Where AI added value, and where I overrode it

AI was most valuable when it could see something I couldn't from reading code alone: diagnosing that SAM's weak confidence scores came from it being zero-shot with no task-specific training, catching a node-postgres timestamp bug that only showed up against a live database, and spotting a latent crash (`MyReportsPage` calling `statusDisplay()` without importing it) invisible in my own testing because my test account had no live reports. In each case, the value was AI helping me see a failure mode I'd have missed alone.

I rejected or significantly modified AI output just as often, always for a specific reason:
- Kept my original RF-DETR model in production over a newer YOLO11 model after a side-by-side test showed it performing worse — going against Roboflow's own "upgrade" framing.
- Reverted an entire per-field confirmation UI (tick icon → labelled button → backend shape → tests) after deciding it solved the wrong problem, replacing it with a single end-of-form confirmation.
- Pushed past a first proposed timestamp fix (a query-level patch) to find the actual root cause, which needed a schema-level fix instead.
- For the UI redesign, every AI-generated reference image went through my own edit before Claude ever touched it.

The throughline: I treated AI output as a strong first draft to interrogate, not a final answer to implement.

---

## Part 1 — CV defect-detection pipeline (UC-007)

UC-007 was our project's flagged "hardest, highest impact" feature: a pipeline analyzing property photos, detecting six defect types (rust, oil_leak, wear, crack, water_stain, debris), and auto-creating tickets above a confidence threshold. I owned it end to end.

**Starting with SAM, then replacing it.** The first version used Roboflow's SAM — zero-shot, no custom training — giving weak confidence (44–52%) and floods of overlapping boxes. Diagnosing that SAM was the wrong tool for the job led to training a custom model instead.

**Backend infrastructure**, built before the model was good: IoU-based deduplication, confidence-threshold routing (auto-ticket vs. manual review), rate-limit retry queuing with backoff, a manager review-queue endpoint, and 26 passing tests. Getting Roboflow integrated required diagnosing a malformed connection string, a mismatched parameter name, and a wrongly-assumed JSON response shape — none visible from docs alone.

**Dataset cleanup**: consolidated 12+ messy labels down to the official six classes, working around a Roboflow UI credit-restriction by writing the remapping logic myself in Python.

**First trained model (YOLOv8n, 137 epochs)**: uneven results — wear 62.8% mAP50 down to rust at just 6.3%. Rust's near-zero score, despite visually correct source images, pointed to a label-quality issue and too few training examples (this began a deeper rebalancing effort). Also survived a lost-checkpoint scare (fixed by mounting Drive) and a Colab quota exhaustion (fixed by adding Kaggle as backup).

**Rebalancing the dataset**: sourced Roboflow Universe datasets to fix thin classes, converting COCO polygon segmentations to YOLO boxes where needed. Rust went from 0 → 8,747 examples; oil_leak, water_stain, and wear all roughly doubled or tripled.

**Second training round (YOLO11 Large, 34 epochs)**: mAP50 climbed to a peak of 53.6%, with final results of 62.0% precision / 50.4% recall — clearing my 60% precision target and beating the original RF-DETR baseline (56.6%). The three classes I fought hardest to fix (oil_leak, wear, water_stain) became the best performers. Debris stayed weak (26.8% mAP50) despite high annotation count — pointing to a labeling-consistency problem rather than volume. Rust also didn't appear at all in this validation run's output, an open question I couldn't fully root-cause before running out of compute credits. Deploying this model also surfaced missing dependencies, a doubled file path, and an architecture-version mismatch in Roboflow's SDK — all debugged and resolved.

**The honest final comparison**: a structured five-image side-by-side test showed RF-DETR still outperforming YOLO11 despite its broader class coverage. I kept RF-DETR in production — an evidence-based call against the "upgrade" framing, not an assumption.

**What I'd improve next time**: isolate variables (I never got to test RF-DETR retrained on the improved dataset, which would have answered the real question); properly investigate the debris/rust anomalies instead of leaving them open; budget compute earlier instead of reactively switching tools; address label-quality signals sooner.

**What I learned**: to read validation metrics critically rather than at face value, to diagnose whether a CV weakness comes from the model, data, or tooling, and to make and defend an engineering trade-off under real constraints — choosing what actually worked over what looked newest.

---

## Part 2 — OCR paper-form prefill (UC-013)

A feature for inspectors who prefer working from a physical form on-site: photograph a completed paper form, and the system reads it via `gpt-4o-mini` vision, prefilling the digital 25-item checklist as an editable draft the inspector must review, correct, sign, and submit normally.

**Guard rails built in**: every prefilled field marked unconfirmed until checked; fields below 0.80 confidence flagged "please check"; unreadable items left blank rather than guessed; severity and defect photos never OCR-inferred; the endpoint never writes directly to the database — only the inspector's own signature makes a record valid.

**Debugging that got it from "built" to reliable:**
- A permanent "OCR unavailable" state turned out to be a missing `OPENAI_API_KEY`, not a bug.
- Scans were failing with "Couldn't read that photo" because the form-scan upload was reusing the same 100KB/1600px compression target as small defect thumbnails — illegible for a full A4 page of handwriting. Fix: raise the client-side cap to match the backend's real 5MB limit.
- A validation error was firing correctly but rendering off-screen above a 25-item form while Submit sat at the bottom, making failed submits look like nothing happened. Fixed by auto-scrolling the alert into view.
- A "26 items, expected 25" error on a re-scan of the same photo pointed to the vision model itself being unreliable — occasionally splitting one two-part question into two entries. First fix: an explicit prompt constraint plus one retry. When the same failure resurfaced later, the more robust fix added an `item_number` to each returned entry so mismatched counts could usually be reconciled on the spot, with retries increased to three and each retry told what went wrong previously. Covered by dedicated reliability tests, not just the happy path.
- The OCR was hallucinating remarks by echoing question text back as handwriting. Found by comparing OCR output row-by-row against the real paper form. Fixed via prompt engineering — making "no remark" the explicit expected default.

**UX iteration**: auto-fill for lift/block/address and two dates went through a tick-icon → labelled-button → reverted entirely once I realized per-field confirmation was the wrong shape of the problem. Replaced with a single end-of-form confirm gate matching how the paper process actually works — including cleanly reverting the backend response shape and tests written for the earlier approach.

**Perceived performance**: scans felt slow with no feedback, so it looked broken even when it wasn't — fixed with an in-progress message rather than an actual performance fix.

**A later refinement** closed two remaining gaps using the simpler existing confirm pattern: lift code now auto-selects the matching lift (marked unconfirmed, consistent with existing UX) instead of just warning on mismatch; and two previously-unextracted fields (spot-check date, rectification date/who) are now shown as visual reference only, deliberately not persisted to the database.

**What I'd improve**: stress-test the "endpoint simply never writes" guarantee more explicitly against malformed or partial responses.

**What I learned**: since I couldn't fine-tune `gpt-4o-mini` for this form layout, the real engineering work was building guard rails that made its imperfect output safe to use — reinforcing that a model's raw output is rarely trustworthy enough to act on unsupervised.

---

## Part 3 — UI/UX redesign across the whole app

This made the rest of the app — not just my two features — look and feel like one coherent product.

**Where the references came from**: not a single AI output taken at face value. I used ChatGPT to research design patterns and merge them into something fitting an estate-management context, producing a first pass of mockups I then edited myself. Only the finalized, self-edited images went into Claude to implement. The rounds of "no, like this" during implementation were mostly me catching drift between Claude's output and those already-edited references — not accepting a first attempt at either the design or the build.

**Starting point**: an inspector navigation cleanup (missing way back to homepage, a redundant "My Reports" button, mislabeled "past reports," an overly-filtered "around the estate" tab).

**Design system foundation**: `theme.js` (Inter font, 12px radius, soft shadows), a new shared `AppShell.jsx` sidebar/top-bar replacing per-role nav bars, an extracted `AccountMenu.jsx`, and new shared components (`StatTile`, `EmptyState`, `Sparkline` — real data only, never fake placeholders — `AnimatedNumber`). The color palette went through iterations before settling on navy/blue for the shell with status colors reserved strictly for semantic meaning.

**Pages redesigned** against the finalized mockups: Home, Report Issue, My Reports, Status Board (resident); Dashboard, Notifications (manager); Inspector Home, New Inspection, Inspection List (inspector) — each matched to its specific mockup, with a few rounds spent on pages that briefly lost the navbar or picked up the wrong role's navigation.

**A real feature born from "the pages look empty"**: rather than fake content, I built an actual Feedback feature (migration, model/controller/routes, 5 passing tests, service layer, page), an Emergency Contacts page with real numbers, a factual FAQ page, and a Notices page.

**Bugs caught during the redesign** (not just cosmetic): `Sparkline` passing a palette key string into MUI's `alpha()` (would have thrown at render); the latent `MyReportsPage` crash from a missing `statusDisplay()` import, caught live by me; a `useMemo` violating React's rules of hooks after a conditional return (caught by lint); a dev server that wasn't actually running, diagnosed by an actual port check.

**Deliberately not fixed or built**: the contractor role's missing dedicated sidebar was documented as a known issue rather than fixed in this pass; a weather widget, GPS estate map, real Notices content, inspector scheduling, and showing report details on the public Status Board (blocked by an already-tested privacy guard) were all explicitly flagged as out of scope rather than faked.

---

## Part 4 — Later work: report editing and a git merge

**A subtle bug I wouldn't have caught by reading code**: the 30-minute report-edit window was rejecting reports instantly. Root cause was a node-postgres timestamp-parsing gotcha — `TIMESTAMP` columns being parsed as local server time instead of UTC — needing an actual live database check to diagnose.

**Systematic test-writing**: once pointed at a real coverage gap, it wrote tests reproducing genuine failure modes, including catching its own test bug where a native HTML5 `required` validation was blocking a submit event before my own JS validation ever ran.

**Where I had to steer it:**
- The confirm-UI took two rounds of "no, simpler than that."
- During the git merge, it ran a fixed migration script that cascaded into deleting data I'd just decided to keep — caught its own mistake immediately, was upfront about it, and recovered from a snapshot it had taken moments earlier. I made it set up a proper backup branch before touching the repo further.
- Merging test-folder conventions with a teammate's independently-built work needed a human decision, not a mechanical one.
- The first timestamp fix proposed was a query-level patch that would have left every other place touching that column exposed to the same bug. I asked for the actual root cause instead, which needed a schema-level fix.

## Closing note

The confirm-UI reversal, the OCR prompt fixes, and the design-reference process in Part 3 all followed the same pattern: AI output was never taken as final on the first pass — it went through deliberate editing and testing at each stage before being treated as done.