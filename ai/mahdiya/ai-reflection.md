# AI reflection — Mahdiya

## What I used AI for

My share of the build was UC-007 (computer-vision defect detection) and
UC-013 (paper-form OCR prefill for inspectors who prefer working from a
physical form on site), plus a full UI/UX redesign pass across the whole
app — not just my own two features — and later a UC-003 extension letting
residents edit their own report within 30 minutes of filing it. I used
Claude Code across all of it — not just to write code, but to train and
evaluate the CV model, debug live issues, decide UX tradeoffs, write tests,
and eventually to sort out a genuinely messy git merge with a teammate's
independently-built work. For the redesign specifically, I also used
ChatGPT earlier in the pipeline, before Claude was ever involved — detailed
below.

## Where AI added value, and where I overrode it — the short version

Before the stage-by-stage detail below, here's the throughline across all four
parts: AI was most valuable when it could see something I couldn't from
reading code alone — diagnosing that SAM's weak confidence scores came from
it being a zero-shot model with no task-specific training, catching a
node-postgres timestamp bug that only showed up against a live database, and
spotting a latent crash (`MyReportsPage` calling `statusDisplay()` without
importing it) that was invisible in my own testing purely because my test
account happened to have no live reports. In each case, the value wasn't
"AI wrote the code" — it was AI helping me see a failure mode I'd have missed
on my own.

I rejected or significantly modified AI output just as often, and always for
a specific reason I can point to. I kept my original RF-DETR model in
production over a newer, broader-coverage YOLO11 model once a real
side-by-side test showed it performing worse, deliberately going against the
"upgrade" framing Roboflow's own documentation suggested. I reverted an
entire per-field confirmation UI — tick icon, then a labelled button, then
backend response shape and tests — after deciding it solved the wrong
problem, replacing it with a single end-of-form confirmation that better
matched how the paper process actually worked. When a timestamp bug
surfaced, I pushed past the first proposed fix (a query-level timezone
patch) and asked for the actual root cause, which turned out to need a
schema-level fix instead. And for the UI redesign, I never let an AI-generated
design go straight into implementation — every reference image went through
my own edit after ChatGPT generated it, before Claude ever touched it.

The pattern underneath all of these: I treated AI output as a strong first
draft to interrogate, not a final answer to implement — whether that meant
testing a claim, asking why instead of accepting a patch, or physically
comparing OCR output line-by-line against the real paper form it was
supposed to be reading.

---

## Part 1 — Building the CV defect-detection pipeline (UC-007)

### Overview

UC-007 was the computer vision feature of our estate management app —
flagged by my own team, in our High-Level Design doc, as the "hardest,
highest impact" use case and the project's "showpiece." The pipeline
analyzes property photos, detects six defect types (rust, oil_leak, wear,
crack, water_stain, debris), and automatically creates inspection tickets
when confidence clears a threshold. I owned this feature end to end: dataset
construction, model training, evaluation, backend integration, and frontend
visualization. This is the full build across every stage, with the actual
numbers, decisions, wins, and setbacks along the way.

### Stage 1: Starting with SAM — and discovering it was the wrong tool

The first version of the pipeline was built on a Roboflow workflow using SAM
(Segment Anything Model) — a zero-shot, general-purpose segmentation model
with no custom training on my defect classes. It looked like a working
pipeline on the surface, but confidence scores were consistently weak
(44–52%) and the model returned floods of overlapping, redundant bounding
boxes for the same physical defect.

Diagnosing this was itself a real piece of work: recognizing that a
zero-shot general model was never going to reliably distinguish "rust" from
"wear" from "water stain" without task-specific training. That diagnosis led
to the decision to replace SAM entirely with a custom-trained object
detection model — a much bigger undertaking, but the correct one.

### Stage 2: Backend infrastructure (built before the model was even good)

Independent of model quality, I built out the surrounding backend
infrastructure early and solidly:

- A deduplication service using IoU (Intersection-over-Union) to collapse
  the many overlapping bounding-box predictions Roboflow's models return for
  a single real-world defect into one clean detection.
- Confidence-threshold decision logic — high-confidence detections
  auto-create a maintenance ticket, low-confidence ones route to a manual
  review queue.
- Rate-limit resilience: when Roboflow returns a 429, the image is queued
  rather than the request failing outright, with a scheduled retry job
  using backoff.
- A manager-facing endpoint listing everything in the manual review queue.
- 26 automated tests covering confidence thresholds, rate-limit queuing,
  retry processing, and auth/role gating — all passing.

On the frontend, I also built and visually verified a component that draws
detected bounding boxes directly on the defect photo (scaled correctly
regardless of display size), plus a review-queue panel for managers.

Getting the Roboflow integration itself working required diagnosing three
separate, non-obvious failures in sequence: a malformed connection string, a
mismatched input-parameter name between my code and the deployed Roboflow
workflow, and a wrong assumption about the response JSON's shape
(predictions were nested one level deeper than expected). None of these were
visible from documentation alone — each required actual debugging.

**Win:** the infrastructure around the model — deduplication, thresholding,
retry logic, testing, visualization — was solid and well-tested well before
the model itself was.

### Stage 3: Cleaning up the dataset taxonomy

Before any serious training could happen, the dataset itself needed real
cleanup. It started as a messy set of 12+ overlapping/inconsistent class
labels, which I consolidated down to the official six-class UC-007 spec
(crack, debris, graffiti, oil_leak, rust, water_stain, wear) using a
combination of Roboflow's UI merge tool and, when that hit credit-balance
restrictions, programmatic label remapping in Python instead.

**Challenge, solved with a workaround:** Roboflow's UI rename/merge feature
failed due to credit restrictions — rather than being blocked, I wrote the
remapping logic myself in the training script.

### Stage 4: First real trained model (YOLOv8n on Colab)

With SAM replaced and the dataset cleaned, I trained a proper YOLOv8n model
on Google Colab's free T4 GPU — 150 epochs, stopped early at 137. This
produced genuinely usable, if uneven, per-class results:

| Class | mAP50 |
|---|---|
| wear | 62.8% |
| oil_leak | 57.8% |
| water_stain | 54.9% |
| crack | 43.4% |
| graffiti | 34.5% |
| debris | 23.6% |
| rust | 6.3% |

Rust's near-zero score was the standout problem — I confirmed visually that
the rust images in the dataset genuinely looked correct, which pointed
toward label quality or annotation consistency rather than bad source
images. This is also where the deeper class-imbalance investigation began
(rust had far too few training examples at this stage).

Challenges along the way: lost trained weights once when Colab's runtime
recycled mid-session — fixed by mounting Google Drive so every checkpoint
saved persistently going forward. Also exhausted Colab's free GPU quota,
which led to building a Kaggle Notebooks backup pipeline as a second
training environment.

### Stage 5: Fixing the rust class and rebalancing

This is where the bulk of the dataset engineering happened. I sourced
public object-detection datasets from Roboflow Universe specifically to fix
rust and the other thin classes, filtering out sources with the wrong
annotation type (instance segmentation instead of bounding boxes) and
writing a conversion pipeline to turn COCO polygon segmentations into
YOLO-format boxes where a dataset was otherwise a strong match.

**Result:**

| Class | Before | After |
|---|---|---|
| rust | 0 | 8,747 |
| oil_leak | 314 | 963 |
| water_stain | 410 | 609 |
| wear | 206 | 711 |

I deliberately excluded a "car" sub-category from one rust dataset since it
labeled the vehicle rather than the rust defect itself, and considered —
then rejected — the shortcut of trimming my strong classes down to match the
weak ones, since that would have discarded most of my best data for no real
gain.

### Stage 6: Second training round (YOLO11 on Colab, deployed via Roboflow)

With the rebalanced dataset, I trained a new YOLO11 Large model, watching
mAP50 climb from 18.9% (epoch 1) to a peak of 53.6% (epoch 26) over 34
epochs. Final validation results:

| Class | Precision | Recall | mAP50 |
|---|---|---|---|
| oil_leak | 69.3% | 75.7% | 75.8% |
| wear | 71.2% | 61.8% | 66.5% |
| crack | 66.5% | 54.4% | 61.0% |
| water_stain | 62.2% | 48.4% | 51.6% |
| graffiti | 50.4% | 39.2% | 40.1% |
| debris | 52.3% | 23.1% | 26.8% |

Overall: 62.0% precision, 50.4% recall, 53.6% mAP50 — clearing the 60%
precision target I'd set for the project, and a real jump from the original
RF-DETR baseline (56.6% precision).

**Win:** the three classes I fought hardest to fix — oil_leak, wear,
water_stain — became the model's best-performing classes, real evidence the
dataset work paid off. Wear in particular improved from 62.8% mAP50 (first
YOLOv8n run) to 66.5% here.

**Unresolved:** debris stayed weak (26.8% mAP50, 23.1% recall) despite
having the second-highest annotation count in the whole dataset — pointing
to a labeling-consistency problem rather than a volume problem. Rust also
didn't appear in this particular validation run's per-class output at all,
despite being the largest class by count — a genuine open question I wasn't
able to root-cause before running out of compute credits to dig further.

Deploying this model back into Roboflow (so it could sit behind the same API
my backend already called) surfaced a real chain of integration bugs —
missing dependencies, a doubled file path, and an architecture-version
mismatch between YOLOv8 and YOLO11 packaging code in Roboflow's SDK — all of
which I debugged and resolved.

### Stage 7: The honest final comparison

Once both models were live, I ran a structured side-by-side test — five
identical images through both my original RF-DETR checkpoint and the new
YOLO11 model. RF-DETR performed better on this direct comparison, despite
the YOLO11 model's broader, more balanced class coverage. Rather than
deploying the newer model by default, I made the deliberate call to keep
RF-DETR in production and update the backend accordingly.

**Win:** this was an evidence-based engineering decision, not an assumption.
I didn't ship the newest model because it was newest — I tested both and
picked the one that actually performed better. This also meant rejecting
the implicit "upgrade" path — Roboflow's own architecture comparison had
described RF-DETR as the higher-accuracy option and framed YOLO11 as the
faster, more actively-developed alternative, which made switching feel like
the natural default. I went against that framing once the actual test data
disagreed with it.

### What I'd improve next time

1. **Isolate variables in experiments.** Comparing RF-DETR-on-old-data
   against YOLO11-on-new-data conflated architecture and dataset changes at
   once. The one experiment that would have actually answered the real
   question — RF-DETR retrained on the improved dataset — never got run,
   because I ran out of Roboflow credits before I could test it.
2. **Investigate the debris and rust anomalies properly**, rather than
   leaving them as open questions. Debris's weak recall despite high volume
   suggests a labeling audit is needed. Rust's disappearance from one
   validation run needs a proper root-cause check in the data export step.
3. **Budget compute earlier.** I hit credit and quota limits reactively
   across Roboflow, Colab, and Kaggle, which forced tool-switching
   mid-project instead of a planned, stable training environment from the
   start.
4. **Address label quality earlier.** Rust's near-zero score in the first
   YOLOv8n run, despite visually correct source images, was a signal about
   annotation consistency that I moved past rather than fully investigating
   at the time.

### What I learned

Beyond the model itself, this project taught me to read validation metrics
critically instead of at face value — distinguishing aggregate precision
from a single detection's confidence score, and understanding that a 62%
precision model can still return a 14% confidence guess on an ambiguous
image without that being a contradiction. I learned to diagnose whether a CV
pipeline's weakness is coming from the model, the data, or the tooling
around it — as with recognizing SAM's zero-shot limitations early rather
than blaming training settings. I built real, transferable dataset
engineering skills (format conversion, class remapping, imbalance
correction) and debugged across three different cloud training environments
and two different model-serving pipelines. Most of all, I learned to make
and defend an engineering trade-off under real constraints — choosing the
model that actually worked, not the one that looked newest on paper.

---

## Part 2 — Building the OCR paper-form prefill (UC-013)

### Overview

UC-013 is the paper-form OCR prefill feature — a separate piece of work from
my main CV defect-detection feature (UC-007), built for inspectors who
prefer filling out the physical checklist on-site rather than tapping
through the digital form live. It was never a client requirement — it's a
deliberate adoption aid. The core idea: an inspector photographs a completed
paper form, and the system reads it, prefills the digital 25-item checklist
as an editable draft, and lets the inspector review, correct, sign, and
submit through the app's normal submission flow.

### Design stage: understanding what the feature actually needed to do

Before building anything, I worked through the mechanism carefully: a
photographed paper form goes to OpenAI's `gpt-4o-mini` with vision via a
`POST /api/inspections/ocr-prefill` endpoint, which returns strict JSON per
checklist item — a `result` (Pass/Defect/unreadable), a `remark`, and a
field-level `field_confidence`. That response then maps onto the live
checklist by section and display order.

A distinction I had to get clear on early: this is not a straight
transcription tool. It produces a draft the inspector must own — every
prefilled field is visually marked unconfirmed, low-confidence fields get
flagged for extra scrutiny, and nothing gets written to the database until
the inspector reviews and submits it themselves through the standard flow.
Getting this framing right mattered because it shaped several of the actual
guard rails I built in.

### Build stage: what I actually implemented

**Core flow:**

- A "Scan a paper form" action on the new-inspection page.
- Photo upload → OCR endpoint → `gpt-4o-mini` vision call → structured JSON
  mapped onto the checklist.

**Guard rails, deliberately designed in:**

- Every prefilled field marked unconfirmed (amber border) until the
  inspector actively checks it.
- Fields below a confidence threshold (0.80) flagged "please check" rather
  than silently trusted.
- Unreadable items left blank rather than guessed.
- Severity ratings and defect photos are never OCR-inferred — always
  require deliberate inspector input, since those are judgment calls a
  model shouldn't make on the inspector's behalf.
- The endpoint never writes to `inspections`, `checklist_results`, or
  `signatures` tables directly — it only produces a draft; the inspector's
  own signature is what makes the record valid, exactly as it would be for
  a manual submission.

**Edge cases handled:**

- Unreadable scan → returns a `422` error, form falls back to blank.
- Partial reads → readable items prefill, the rest stay blank, with a
  banner showing exactly how many items still need manual input (e.g. "18
  of 25 read — 7 need your input").
- Lift/block code mismatch → if the scanned form's lift code doesn't match
  what's already selected, it warns rather than silently overriding the
  inspector's manual choice.
- OpenAI outage or quota exhaustion → the scan button simply disables; the
  rest of the normal digital-entry flow is unaffected.

### Debugging: getting it from "built" to actually reliable

The core flow above checked out on paper, but several real issues only
surfaced once I actually tested it live, across two separate work sessions
roughly a week and a half apart.

**First pass: "unavailable," and what that actually meant.**

The first real live test of the feature returned a permanent "OCR
unavailable" state. That turned out not to be a bug at all —
`backend/.env` simply didn't have `OPENAI_API_KEY` set (only commented out
in `.env.example`), and the frontend deliberately latches into a permanent
unavailable state once that happens rather than inviting retries that would
just fail the same way again (UC-013 Alt Flow A4). Once the key was set and
verified against a real `gpt-4o-mini` call, the pipeline itself checked out
completely — nothing to build, everything already in place.

#### The bug that actually mattered: illegible photos

With the key sorted, scans still failed with "Couldn't read that photo."
The real cause: the form-scan upload was reusing the same compression
target as individual defect thumbnails — 100 KB / 1600px. A full A4 page
with 25 rows of small handwriting doesn't survive that; the model was being
handed a blurry, illegible image. The backend route already anticipated
this (it allows a 5 MB upload specifically for this endpoint), but the
frontend wasn't honoring that — it was compressing the same as it would for
any small defect photo before ever reaching the network layer. The fix was
one line (raising the client-side compression cap to match the backend's
real 5 MB limit for this specific upload), but finding it took ruling out
the API key, the prompt, and the checklist template first.

#### A validation message that existed but was invisible

Separately, a real usability bug: submitting an incomplete form set a
validation error message correctly, but the `<Alert>` rendered near the top
of a 25-item form while Submit sits at the bottom — so clicking Submit
appeared to silently do nothing. The message existed the whole time; it was
just off-screen. Fixed by auto-scrolling that alert into view whenever it
appears, whether from client-side validation or a server-rejected submit.

#### The 25-vs-26-item bug, in two parts

The first sign of this was a scan that failed with *"OpenAI response has 26
items, expected 25."* on a re-scan of the exact same photo that had worked
moments earlier — identical input, different output, which pointed at the
model itself being unreliable on this specific task rather than at the
photo or the code. Digging into it: the vision model would occasionally
split one two-part question (e.g. "ARD & EBOPS — Functioning? Replacement
date?") into two separate entries, pushing the count to 26 and getting the
whole response discarded over that single mismatch.

The first fix (this earlier session) was two-pronged: the prompt was made
explicit that splitting or adding entries is never allowed and states the
exact required count, plus one automatic retry specifically for a malformed
or wrong-count response.

That held for a while, but the same underlying failure mode resurfaced
later in the project — a form still occasionally came back with the wrong
count even with the stricter prompt, meaning a single retry wasn't always
enough. The second, more robust fix (later, this session): every returned
entry now carries an `item_number` saying which numbered checklist item it
actually answers, so when the count is wrong it can usually be reconciled
back to the correct 25 answers on the spot instead of being discarded
outright — it only falls through to a retry (now three attempts total, not
one) when there's a genuine gap `item_number` can't safely fill in. Each
retry after the first also now tells the model exactly what went wrong on
the previous attempt instead of repeating the identical prompt, which
tended to just reproduce the same mistake. Both the reconciliation logic and
the retry behavior are covered by tests that reproduce the actual failure
modes (`backend/tests/mahdiya/ocrReliability.test.js`), not just the happy
path.

#### The remark-hallucination bug

Separately from the item-count issue, the OCR was inventing remarks on
checklist items that had none on the real paper form — specifically,
echoing the question text back as if it were a handwritten remark. I found
this by holding the OCR output next to a photo of the real form and
comparing row by row, which made the actual root cause obvious: the
prompt's wording implied every Defect row should have a remark, so the
model manufactured one rather than saying "none." The fix was prompt
engineering, not code — being explicit that "no remark" is the normal,
expected answer, and that the model should never restate the question text
as if it were handwriting.

### UX: auto-fill, and un-building most of it

I asked for the OCR step to also auto-fill the lift/block/address and the
two dates (servicing date, spot-check date) from the scanned form, with a
confirm step before submitting. First pass used a small tick icon per field
to confirm each auto-filled value. I didn't like it — not obvious enough —
so that became a labelled "Confirm" button per field instead. Then I
realised per-field confirmation was the wrong shape of the problem
entirely: I didn't want the inspector confirming five separate things, I
wanted one clear "have you checked everything?" moment right before the
signature, matching how the paper process actually works. That meant
reverting the two-dates auto-fill feature and the per-field confirm UI back
out — including the backend response shape and the tests written for it —
and replacing all of it with a single end-of-form confirm gate. Backing out
cleanly, without leaving half-reverted code behind, was the main thing to
watch for here.

There was also a later UI restyle pass on the same New Inspection page —
matching a design mockup (sidebar plus a "Back to Home" link together, not
one replacing the other, after getting that wrong once on a different page
first) without touching the checklist logic underneath, since that logic
(OCR prefill, per-item severity/photo rules, e-signature, validation) was
too extensive to risk in a restyle.

### "Why is the scan so slow?"

Once the pipeline worked reliably, the actual remaining complaint was UX,
not correctness — the scan felt slow with no feedback, so it looked broken
even when it wasn't. The fix was a reassuring in-progress message while the
request is in flight, not a performance fix — a good example of a problem
that looked technical but was really about perceived wait time.

### A later refinement: lift code auto-fill and two new date fields

After the initial build (and after backing the two-dates auto-fill and
per-field confirm UI back out, above), I worked through a follow-up
engineering plan that closed two remaining gaps — this time using the
simpler, already-established confirm pattern instead of reintroducing
per-field confirmation:

1. **Lift/block code wasn't being used properly.** The OCR was already
   extracting the lift code from the form, but it only warned on a
   mismatch rather than auto-selecting the correct lift. The fix auto-picks
   the matching lift when none is selected yet, marked "unconfirmed" with
   the same amber treatment as checklist items — consistent with the
   existing UX pattern rather than inventing a new one.
2. **Two fields on the paper form weren't being extracted at all** —
   "Date of spot checking" and "Date of Rectification" (plus who performed
   the rectification). I added extraction for these, but deliberately did
   not persist them to the database — they're shown only as a visual
   reference so the inspector can eyeball-check them against the physical
   form. No schema changes, no migration needed.

A design decision I had to actually think through here: whether confirming
these fields should be mandatory before the form could be submitted. I kept
it consistent with how the rest of the checklist already worked —
confirmation is a visual nudge, not a submission blocker — rather than
introducing an inconsistent rule for just these two fields.

### Integration work

UC-013 shares infrastructure with the rest of the app rather than needing
its own setup: it reuses the already-configured `OPENAI_API_KEY` and the
existing `openaiService.js` file (the same service used elsewhere in the
app for incident categorization and risk alerts), so there was no new key
provisioning or separate service to stand up. It's a genuinely lightweight
integration in that sense — the complexity was in the mapping and
guard-rail logic, not in wiring up a new AI dependency.

I also had to keep this cleanly separated in my own head from UC-007: two
parallel but non-overlapping AI integrations sitting in the same app —
Roboflow/YOLO reads photos of physical defects, `gpt-4o-mini` vision reads
photos of a paper form. Different models, different endpoints, different
purposes, easy to conflate if I hadn't been deliberate about keeping them
distinct in both the code and my own understanding of the spec.

### Testing

Beyond the reliability tests covering the item-count reconciliation and
retry behaviour (above), I wrote tests covering the mapping logic and a
manual re-scan test specifically to verify that the two new date fields
never leak into the submitted payload — an easy mistake to make silently,
since the extraction logic touches the same response object as the fields
that are meant to be saved.

### What I'd improve next time (UC-013)

The database-write guard rails were the right call, but I'd want to
stress-test them more. The design leans on "the endpoint simply never
writes" as the safety mechanism, which is solid in principle, but I'd want
more explicit tests confirming this holds under edge cases like a malformed
or partial OpenAI response.

### What I learned (UC-013)

This feature taught me something different from UC-007's model-training
grind: here, the hard part wasn't training or tuning a model — it was
interface design around an AI output I didn't control. Since `gpt-4o-mini`
is a general-purpose vision model I couldn't fine-tune for this specific
form layout, the real engineering work was in building guard rails that
made its imperfect output safe to use — confidence flagging, mandatory
human confirmation, and strict boundaries on what the model was and wasn't
allowed to decide (never severity, never whether to actually submit). It
reinforced a principle that also showed up in UC-007: a model's raw output
is rarely trustworthy enough to act on unsupervised, and the quality of a
feature often comes down to what you build around the model rather than the
model call itself.

---

## Part 3 — Redesigning the UI/UX across the whole app

This is separate from UC-007/UC-013 specifically — it's the work that made
the *rest* of the app (not just my two features) look and feel like one
coherent product instead of a set of individually-built pages. It happened
mostly in one focused session, with a smaller inspector-navigation cleanup
earlier that fed into it.

### Where the reference designs actually came from

The "reference images" driving this redesign weren't a single AI output I
took at face value — they went through several distinct rounds of AI use
and my own editing before Claude ever touched them. I used ChatGPT first to
research professional website design patterns, then to merge several of
those separate design languages into something that actually fit an estate
management context rather than looking like a generic template. That
produced a first pass of generated mockup images per page — which I then
edited myself before they were considered final, rather than handing them
to Claude as-is. Only after that editing pass did the finalized images go
into Claude to actually be implemented as real components and pages.

This mattered in practice: it meant Claude was never working from a raw,
unfiltered AI suggestion for what the app should look like — it was working
from a design I'd already put through two rounds of AI-assisted iteration
and one round of my own hands-on correction. The "several rounds of 'no,
like this' against screenshots" during implementation (below) were largely
me catching cases where Claude's rendered output had drifted from those
already-edited reference images, not cases of accepting a first attempt
at either the design or the build.

### Starting point: an inspector navigation cleanup

Before the wider redesign, I flagged a set of real navigation problems on
the inspector side: no way back to the homepage once the new-inspection tab
was open, a "My Reports" button that was redundant now that a dedicated new
inspection page existed, "past reports" that should have read "past
inspections" to match what an inspector actually does, and an "around the
estate" tab that should let inspectors view every record, not a filtered
subset. Small individually, but the kind of paper-cut UX problems that make
an app feel unfinished even when every feature technically works.

### The full redesign: bringing every page under one design system

I gave Claude an explicit design brief: model the whole platform against
the finalized reference images described above, without inventing,
removing, or rearranging any actual functionality — a real UI/UX pass, not
a rebuild. Concretely, that covered:

**Design system foundation:**

- `theme.js` — Inter font, 12px corner radius, soft shadows, hover
  micro-interactions, sticky-friendly table styling. The color palette went
  through a few iterations before landing on a navy sidebar with blue as
  the primary action color, with red/orange/green/purple reserved strictly
  for status semantics (open/in-progress/resolved/etc.) rather than used as
  general brand color.
- `AppShell.jsx` — a new shared sidebar + top-bar component, replacing the
  old pattern of a separate per-role `AppBar` with its own inline nav. Dark
  navy sidebar, blue active-state highlight, a collapsible mobile drawer, an
  optional "quick access" section, and an optional real-phone-number
  footer.
- `AccountMenu.jsx` extracted out of `AppShell` so the avatar/dropdown logic
  wasn't duplicated per role.
- New shared components: `StatTile` (the icon-badge KPI card now reused on
  Home/My Reports/Inspector Home), `EmptyState`, `Sparkline` (a trend line
  that only ever renders real data, never a fake placeholder trend), and
  `AnimatedNumber`.
- A new `categoryDisplay.js` util (icon + color per defect category),
  alongside palette tweaks to the existing `statusDisplay.js`/
  `priorityDisplay.js`.

**Pages redesigned against the reference images**, page by page, with
several rounds of catching drift between Claude's rendered output and the
already-finalized mockups (above): `HomePage`, `ReportIssuePage`,
`MyReportsPage`, and `StatusBoardPage` on the resident side; `DashboardPage`
and `NotificationsPage` for managers; `InspectorHomePage`,
`NewInspectionPage`, and `InspectionListPage` for inspectors. Each page got
matched to its specific mockup rather than redesigned freehand, and the
same navbar/sidebar had to stay visually consistent across every one of
them — a couple of rounds went into pages that briefly lost the navbar or
picked up the wrong role's navigation during the pass.

**A genuinely new feature that came out of "the pages look empty":** rather
than padding empty pages with fake content, I had a real Feedback feature
built — migration `036_create_feedback.sql`, model/controller/routes, 5
passing backend tests, a service layer, and a `FeedbackPage.jsx` — plus a
real `EmergencyContactsPage` (actual numbers, Police/Fire), a factual
`FAQPage`, and a `NoticesPage`. A "quick access" sidebar section was added
for residents; I asked for the same section removed again for managers once
I saw it there, and it came out cleanly.

### Bugs caught during the redesign, not just cosmetic changes

- `Sparkline` was passing a palette *key* string straight into MUI's
  `alpha()`, which needs an actual resolved color — would have thrown at
  render on first real use.
- `MyReportsPage` called `statusDisplay()` without importing it — a latent
  crash for any account with a live report, invisible only because the
  account being tested against happened to have none. I caught this myself
  live ("why are all the KPIs empty and I can't submit a report") rather
  than it surfacing on its own.
- A `useMemo` landed after a conditional early return on `DashboardPage`,
  violating React's rules of hooks — caught by lint before it shipped, not
  by me spotting it by eye.
- The backend dev server wasn't actually running at one point in the
  session — diagnosed by an actual port check rather than guessed at.

### What was investigated but deliberately not built or not fixed

- The contractor role has no dedicated sidebar — `RoleLayout`/
  `ResidentLayout` have no `contractor` branch, so every contractor account
  was getting resident-style navigation. I asked for this to stay a
  documented, diagnosed issue rather than being fixed in the same pass —
  a real example of me scoping what got changed and what didn't, rather
  than everything flagged getting auto-fixed.
- A weather widget, a GPS-pinned estate map, real content for the Notices
  page (no backend feed for it exists), an inspector scheduling/calendar
  feature, and showing a resident's actual report title/description on the
  public Status Board (blocked by a real, already-tested privacy guard) were
  all explicitly flagged as not built, rather than faked with placeholder
  data to make a page look more finished than it was.

---

## Part 4 — Later work: report editing and a git merge

Toward the end, I added a UC-003 extension (residents can edit their own
report within 30 minutes of filing) and separately had to resolve a real
git merge conflict against a teammate's independently-built work
(overlapping per-student test-folder conventions).

### Where AI genuinely helped

- **A genuinely subtle bug I would not have caught by reading code.** Live
  testing showed the 30-minute edit window was rejecting reports the
  instant they were created. The root cause was a node-postgres
  timestamp-parsing gotcha — `TIMESTAMP` columns getting parsed as local
  server time instead of UTC — which needed an actual live database check
  to diagnose, not just a code read. That's the kind of bug that's easy to
  miss because the code *looks* correct.
- **Systematic test-writing.** Once pointed at what was untested (a real
  coverage sweep against the actual codebase, not a guess), it wrote real
  tests reproducing real failure modes — not just happy-path padding — and
  fixed its own test bugs when a first attempt didn't actually exercise the
  branch I wanted covered (e.g. a native HTML5 `required` validation
  blocking a submit event before my own JS validation ever ran, in a
  `ManualReviewQueue` test).

### Where I had to steer or correct it

- The confirm-UI iteration above — it took two rounds of "no, simpler than
  that" before landing on the right shape.
- During the git merge, it made a real mistake — running a fixed migration
  script that cascaded into deleting data I'd just decided to keep. It
  caught the mistake immediately, was upfront about it, and recovered
  everything from a data snapshot it had taken moments earlier. I made it
  stop and set up a proper backup branch before touching the repo further
  after that.
- I had to explicitly decide when documentation or test-folder conventions
  should match what a teammate already built on `main`, rather than letting
  it pick its own convention — merging two people's independent work needed
  a human decision, not a mechanical one.
- The first fix proposed for the timestamp bug was to patch the query with
  a timezone conversion at the point the 30-minute check ran — a targeted
  patch that would have worked for that one query but left every other
  place in the codebase touching that same `TIMESTAMP` column exposed to
  the identical bug. I asked for the actual root cause instead, which
  turned out to be the column type itself accepting ambiguous timestamps —
  the real fix was a schema-level change (using a timezone-aware column
  type), not a query-level patch.

## Modifications from what it first proposed

The confirm-UI reversal (above) and the OCR prompt itself both went through
real editing before landing on the right answer — in the OCR case, the fix
wasn't "ask it to try again," it was being specific about what "no remark"
should look like versus what a hallucinated one looked like, using the real
paper form as the reference; and later, being specific about *why* a single
retry wasn't enough for the item-count problem, which is what led to the
`item_number` reconciliation approach instead of just retrying more. The
design-reference process in Part 3 followed the same pattern — AI output
(from ChatGPT, then Claude) was never taken as final on the first pass; it
went through deliberate editing at each stage before being treated as done.