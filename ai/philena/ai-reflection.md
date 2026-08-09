# AI Reflection - Philena

## My ownership in the system

I built the core inspection lifecycle that the rest of the team's features connected to: the project foundation and authentication, resident complaint submission and the inspector lift spot-check (UC-001), manager triage (UC-002), close with dual e-signature (UC-004), the audit trail (UC-015), and resident self-registration with manager approval. On top of building those features, I ran an extended hardening pass across all of them, personally finding and closing a long series of correctness, security, and integrity gaps, and I carried the project's deployment from first setup through to a live, working site. Because my part sat at the centre of the workflow, correctness and clean coordination with teammates were on me at every step, and I used AI as a tool inside that work rather than as a substitute for it.

## How I worked with AI

I did not let AI drive. I set the direction and used it as an instrument I kept under close control. Before it wrote anything I decided what needed to be built and how it should fit the system I already understood; I made it produce a plan first, I checked that plan against the real code and data, I only let it generate once I was satisfied the approach was right, and then I verified the result myself, usually against the live database rather than trusting a passing test. The judgment, the architecture decisions, and the final say were always mine; the AI mainly saved me typing time on work I had already worked out. My prompting reflected that: I told it exactly what to read first, what constraints to hold to, and what not to touch, because I already knew the shape of the answer I was steering it toward.

The habit I relied on most was refusing to trust a green test suite. Twice I caught the AI's tests passing while testing nothing, because the mock silently ignored part of the real query. I only found that by reading what the mock actually matched and checking behaviour against the real system myself. Learning to distrust "all tests pass" and verify against reality was the most valuable engineering lesson of the module, and it came from staying hands-on enough to catch the tool being wrong.

## Where AI genuinely helped

**1. Faster to a first plan I then took apart.** When I had a feature in mind but wanted a second pass on structure, for example the resident signup with manager approval modelled on iCondo, I would have the AI sketch a staged plan (a pending status on the user row, a manager approval screen, a login gate) and then I worked through it and shaped it into the real design. It was useful as a sounding board, but the security backbone was mine to insist on: I made the account-creation endpoint hardcode `role='resident'` as a SQL literal so no request could ever escalate a signup into an admin account, and I proved it with an adversarial test.

**2. A second pair of eyes that occasionally caught something.** A few times the AI flagged a problem I then confirmed and fixed myself, such as a merge conflict against a teammate's CV controller, or a test of mine that was passing without asserting anything real. I treated those as prompts to go and check, not as fixes to accept; the diagnosis and the correction were still my work.

**3. Speed on mechanical work I had already specified.** For repetitive work like wiring a field through model, controller and form, or writing a migration in the same shape as an existing one, I used the AI to move faster on patterns I had already decided on, which freed my attention for the decisions that actually mattered.

## Where I rejected or significantly modified AI suggestions

This is the part I am most proud of, because it is where my own engineering did the work and the AI's output was clearly not good enough to ship as-is. Blindly accepting it would have introduced real bugs and, in one case, a security-relevant regression.

**1. Endorser rules, where I overrode the AI and then the "obvious" reading of the spec.** For the close feature (UC-004), a record must be endorsed by a second signatory. The AI's version let the endorser fall back to any user. I rejected that outright, because an audit signature has to be truthfully attributed, and I built the backend to verify that the endorser's stored role genuinely matches the role being claimed, returning a specific `ENDORSER_MUST_BE_INSPECTOR` error otherwise. When a strict reading of the design doc then said the endorser must be an inspector, I realised that would leave resident complaints (which have no assigned inspector) permanently uncloseable, so I designed the correct middle path myself: the manager nominates any active inspector, served through a new `GET /api/users/inspectors` endpoint I built for it. Neither the AI's answer nor the doc's literal wording was right; getting it right needed my understanding of the actual data. While reviewing the flow I also spotted that a rejected close could leave orphaned signature files behind, and I moved the validation ahead of the upload to close that gap.

**2. GPS as an audit stamp, not a locator.** The AI treated captured GPS coordinates as if they identified which block or lift a report was about. I rejected that framing entirely. GPS records where a phone happened to be at submit time; it is evidence for the audit trail, not a source of truth about the estate, and since our estate is fictional the coordinates are placeholders. I designed it so the location only ever suggests a nearest block and never overrides the user's own selection, keeping the raw coordinates purely for the audit record. I also found and fixed a real defect here myself where one block's placeholder coordinates sat so far from the others that the nearest-block suggestion could never return it, quietly turning a five-way choice into a four-way one.

**3. "All tests pass" was not good enough, twice.** On two separate occasions I caught the AI reporting a passing suite for logic that did not actually work, because the fake database ignored a filter (a `= ANY(...)` status filter in one case, an audit-action filter in another). I found both by reading what the mock really matched and checking against the live Supabase database. Fixing the second mock surfaced five existing close tests that had been silently passing while closing records no inspector had ever reviewed, which I then had to correct. Verifying against reality rather than trusting the tool's output is a discipline I will carry into every future project.

**4. Auto-close behaviour, where I caught a status change that should not have happened.** Implementing the zero-defect auto-close, where a clean inspection files straight to Closed, the AI's approach would have quietly altered record status with knock-on effects for the manager's queue and a teammate's cost dashboard. I traced how the `is_deleted` flag interacts with other people's queries and rebuilt the change to stay inside a single transaction, so a clean check is never briefly visible in the wrong place, and I flagged the downstream cost-query bug to the teammate who owned it rather than editing his file.

**5. Keeping AI out of my teammates' code.** More than once the AI was ready to "fix" a problem sitting in a teammate's file, such as the CV controller, an OCR response contract, or a migration another member owned. I stopped it every time. Editing someone else's file from a code read alone, without their context, is how merge conflicts and broken features happen, so instead I wrote the owner a precise, evidence-backed note with exact file and line references so they could fix it properly. That decision was about protecting the team's collaboration, and it was mine to make.

## How my work shows in the build

The decisions I made show up directly in the parts of the system a marker can inspect.

**Design integrity.** I designed a single normalised `inspections` table with a `source_type` discriminator, a reusable checklist template of the 25 real checkpoints from the client's paper form, and dedicated `signatures` and `inspection_history` tables, so the resident and inspector flows share one triage-and-close pipeline while retired checklist items are deactivated rather than deleted, preserving foreign keys and history.

**Specific error contracts.** Rather than generic failures, I made my endpoints return documented codes such as `INCOMPLETE_CHECKLIST` (which names the missing items), `SEVERITY_REQUIRED`, `PHOTO_REQUIRED_FOR_SEVERITY`, `ENDORSER_MUST_BE_INSPECTOR`, `NOT_REVIEWED`, and `ACCOUNT_PENDING` / `ACCOUNT_SUSPENDED`, so the frontend could tell users exactly what went wrong.

**Security by construction.** I built a single route gate that refuses anyone not signed in, pending, suspended, or rejected before any screen mounts, so a blocked account is treated exactly like a logged-out one, with role and status hardcoded server-side and identity always taken from the verified token. During hardening I traced a real bug where a failed profile fetch was silently dropping any role into the resident view, and closed it so a suspended account can never land inside the app.

**Honest testing.** I wrote tests that assert real behaviour, including an adversarial signup test that spoofs an admin role and a foreign id in one request and proves the created row is still a pending resident under the caller's own id. I document the true pass counts rather than claiming a false all-green, and named the small number of known failures that live in teammates' modules.

## Deployment

I handled the deployment end to end, and it was where the work was most clearly mine, because almost every failure only showed up against the live environment and no amount of prompting could substitute for actually diagnosing and fixing it there. I worked through a chain of real problems: a build that failed because the platform looked for a package file at the repository root when our project is split into separate `frontend` and `backend` packages, which I fixed by setting the correct root directory; single-page-app routes that returned a 404 on refresh, which I fixed with the right rewrite configuration; and a host migration when one platform's free tier ran out, moving the frontend from Netlify to Vercel while keeping the backend on Render, which meant reasoning through which piece lived where and updating the API URL and CORS origin to match.

The hardest was a CORS failure that only affected the live site: after moving hosts, the API calls worked but every real-time socket connection was rejected. I worked out that Socket.IO carries its own CORS configuration separate from the main server's, and that its allowed origin was still pointing at the old host, and I fixed it to read the frontend URL from an environment variable like the rest of the app. The AI could explain the general mechanism, but I was the one who reproduced the failure live, located it, applied the fix, and confirmed it worked against the deployed site. The end result is a fully deployed system with frontend, backend, database, and file storage all live, and a README I verified against the actual project files that documents how to run it locally, how to deploy it, the public URL, the database setup, and how to run the tests.

## Working with my group

My part sat at the centre of the system, the inspection lifecycle that other members' features plugged into, so coordination was on me constantly, and I handled it deliberately.

I built a shared help and contacts component that four teammates needed to plug their role's values into, and I designed it as a single role-keyed config so nobody would have to touch the shared component's structure, then sequenced it to merge first so I was not blocking anyone.

When I found bugs outside my area, such as an over-escalated notification severity, a cost dashboard filter that could never return rows, and a broken notification route, I wrote the owners precise handover notes with exact file and line citations rather than reaching into their code myself.

When a scope question came up, such as whether residents should self-register or whether managers should create accounts, I recognised it as a team decision rather than something to build unilaterally, and raised it with the group and my tutor before committing to an approach.

Throughout, using AI made me a more precise teammate, more disciplined about boundaries, rather than one who quietly did more alone.

## What I learnt

**AI is strongest at the start and the middle, and weakest at the point of truth.** It is useful for turning a fuzzy idea into a first plan and for producing mechanical code quickly, but it is least trustworthy exactly when it says "done, tests pass." That is where the work becomes mine.

**Judgment cannot be outsourced.** Every genuinely important decision in my part, such as how endorsement works, what GPS means, whether a status change is safe, and whose file I am allowed to touch, needed me to understand our specific system and data. The AI could not make those calls correctly on its own, and in several cases its first answer was wrong.

**Directing AI well is really about knowing the answer already.** My best results came when I told the AI what to read, what to respect, and what not to touch, because I had already worked out the shape of the solution and was using the tool to execute faster, not to think for me. Vague prompts produced plausible-looking work that failed under scrutiny.

**Security and integrity are where blind acceptance hurts most.** The escalation-proof signup, the truthful endorser attribution, and the suspended-account routing are the places where an accepted-without-review AI suggestion would have created a real vulnerability, not just a cosmetic bug, and each of those was a place I intervened.

## Overall reflection

Using AI well turned out to be a skill in its own right, and not the one I expected. I thought the challenge would be getting the AI to produce good code. The real work was staying in control of it: knowing my own system well enough to tell a correct suggestion from a plausible-but-wrong one, and having the discipline to verify against reality instead of trusting a green tick. The project is faster for having used AI, but it is correct because I made the decisions, caught the mistakes, and did the verification myself. Across the whole build, from the first design decision through an extended hardening pass to a working deployment, keeping the judgment firmly human while using AI as leverage is the thing I will take forward into every project after this.