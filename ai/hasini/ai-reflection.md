# AI Reflection — Hasini

## UC-005 · UC-011 · UC-012

My work on this project was the manager analytics dashboard (UC-005), the
frontend of the admin cost dashboard (UC-011), and vendor management (UC-012)
— onboarding, contracts and renewals. Because both dashboards sit behind the
manager and admin roles, I also ended up owning some of the hardest
cross-cutting problems in the app: role-based routing and the auth loading
states every protected page depends on. I used Claude Code across every
phase — design, build, security hardening, debugging and testing — and the
honest summary is
that it made me faster everywhere, but it only made me *better* in the places
where I pushed back on it, questioned it, or made it prove its claims.

## Where AI added value

**Design before code.** Early on I used AI as a second reader on my use-case
documents and the high-level design, and later ran my own audits of those
documents against the code we had actually built, with AI cross-checking each
claim faster than I could grep for it. Those passes surfaced things I would
never have found by rereading my own writing: my docs cited migration numbers
that had been renumbered, described error codes the middleware never sends,
and in one case described a rule my server didn't actually enforce. The most
serious of these was in UC-012 — when I checked my renewal endpoint against
what the doc promised, it turned out the code compared the new end date
against the *original* contract start, so a hand-crafted API call could
"renew" a contract to an earlier end date and silently shorten it. My UI
never exposed that path, which is exactly why clicking around would never
have revealed it. I rewrote the check so the server rejects any renewal that
doesn't extend the current contract, and added a test pinning both the
shortening and equal-date cases.

**Root-cause debugging instead of symptom-patching.** The two hardest bugs of
my project (described in the next section) were both ones where the visible
symptom pointed nowhere near the cause. What AI gave me there wasn't answers
— it was speed on a method I had to drive: reproduce the failure, rule out
layers one at a time with evidence, and refuse to declare victory until the
mechanism was proven. When the manager dashboard rendered blank, I confirmed
the data layer was healthy first (every analytics query ran clean against
the real database) *before* touching the frontend, which is the only reason
the investigation didn't waste days in the wrong layer. AI made each
hypothesis cheap to test; deciding which hypothesis to test next, and when a
result actually proved something, stayed my job.

**Test coverage against real code.** Pointing AI at a component and asking
"what does this actually decide, and is any of it tested?" was consistently
productive because the answer is checkable. My dashboard page tests mocked out
the child components, which meant the components' own logic — the priority
queue rendering the server's ranking rather than re-sorting it, the scorecard
treating zero as a real figure but null as an em dash, the alert card
reporting the right id without cross-firing its buttons — had no coverage at
all. I closed that gap with 47 targeted tests, using AI to enumerate edge
cases I hadn't considered while deciding myself which behaviours were worth
pinning. I also stopped maintaining my test documentation from memory and
regenerated it from the runners' JSON output instead, after discovering both
README tables had drifted from reality.

**Security that I proved, not assumed.** Security was where I was strictest
with myself, because a dashboard full of estate data is worthless if the
wrong role can read it. Every endpoint I built sits behind two gates — a
verified Supabase token, then `requireRole` — and before my final review I
didn't just trust that wiring: I probed all nine of my dashboard's
endpoints unauthenticated and confirmed every one returns 401, with the
manager/admin gate behind that. The same review checked that all my SQL is
parameterised (no string-built queries anywhere, so injection has no
surface), that rate limiting and security headers are active, and that
nothing sensitive is hardcoded — credentials live in `.env`, with only
`.env.example` committed. The renewal hole I found in UC-012 sharpened the
principle behind all of this: my UI already blocked shortening a contract,
but the server didn't, and *the client is a convenience, not a boundary* —
every rule must be enforced where the request lands, because attackers don't
use your UI. Even small choices got that lens: vendor onboarding generates a
proper login through Supabase Auth rather than any home-rolled password
handling, and suspended accounts are refused at the middleware, not hidden
in the interface. AI accelerated the auditing — enumerating endpoints,
running the unauthenticated probes, sweeping for hardcoded values — but the
standard, and the insistence on proving each claim against the running
server, were mine.

## The two struggles that taught me the most

**Role assignment kept getting scrambled by merges.** For weeks, the most
demoralising recurring bug in my area was role routing: I would type manager
credentials into the login page and land on the resident side. It kept
resurfacing as teammates merged their branches, because five people were
touching the shared auth plumbing and the routing logic contained a hidden
guess — after sign-in there was a one-render gap where the app knew a user
existed but hadn't started fetching the profile yet, and `RoleLayout` treated
any unknown role as `resident` by default. Any merge that disturbed the
timing of that gap re-broke the redirect, and every fix that just reordered
the race was a patch waiting to fail again.

The permanent fix, which I insisted on rather than another patch, removed the
guess entirely: `profileLoading` became a *derived* value (user exists, no
profile yet, no fetch error) instead of a flag toggled by an effect, so there
is no render where the app believes the role is "ready" before the fetch has
begun; and `RoleLayout` now shows a spinner until the role is actually known
instead of defaulting anyone to resident. The lesson I took is a design one,
not a debugging one: never encode a default that silently assigns identity.
A loading state must be explicit, because "I don't know yet" and "resident"
are not the same answer — and a merge will eventually find any place where
you pretended they were.

**The blank manager dashboard, and building in layers of safety.** Late in
the project my manager dashboard began rendering as a pure white page — no
error, no spinner, nothing. The investigation is the piece of work I'm
proudest of, because the symptom was almost perfectly uninformative. Working
through it hypothesis by hypothesis, with AI as a fast pair of hands for each
probe I wanted run, it turned out *three* separate weaknesses were stacked on
top of each other. First, the app had no error boundary, so under React 19
any render-time throw unmounted the entire tree — every possible crash
presented identically as a white void.
Second, our auth context's `getSession()` call had no rejection handler, so a
failed session read left `loading` stuck true forever, and the protected
route renders nothing while loading — the same blank page by a completely
different route. Third, the actual trigger: a Vite alias added so
out-of-package tests could resolve imports was applying globally, which took
`@mui/icons-material` out of Vite's CommonJS-to-ESM pre-bundling. The dev
server handed the browser a raw `require(...)` module, its default export
came back as a plain object, and React refused to render it. The build and
the test runner were both fine — only the dev server was broken, which is
why every check I had run beforehand looked green.

Fixing the trigger alone would have left the app one throw away from another
untraceable white screen, so I treated the incident as a reason to add
defence in depth: I scoped the alias to tests only (the real fix), wrapped
the app in an `ErrorBoundary` so a crash shows its actual message and a
reload button instead of a void, and gave the auth context a failure path
through to the login page instead of hanging. In the same spirit I hardened
startup itself: during development, a stale server process holding port
5000 would make the next launch die with `EADDRINUSE`, so `npm run dev` on the backend
now runs two statements — a `predev` guard that finds and clears anything
holding the port, then the server itself. What made that guard genuinely
educational is that its first version *silently did nothing* on my machine: a
Windows PATH quirk meant `netstat` couldn't resolve, and the script's
try/catch read "command not found" as "nothing listening on the port". I
only caught this by insisting the guard be tested against a real stale
listener — and watching it fail to fire. It now resolves the system tools by
absolute path, checks they exist up front, and I verified it against all
three scenarios — stale process, clean port, and missing tooling. The
lesson: a safety net that fails silently is worse than no safety net,
because it buys confidence without buying protection. Verify that your
guards actually fire.

## Where I rejected or significantly modified AI suggestions

**Branching strategy.** During the dashboard polish work, the AI suggested
carrying on under a fresh branch (`feat/uc5-dashboard-polish`) on the
textbook logic that merged branches shouldn't be reused. I rejected that and
kept the work on my original `feat/analytics-dashboard` branch: our team's
review flow, PR history, and my traceable individual contribution all lived
on that branch, and a second branch for the same use case would have fragmented the story my
Git history tells. Textbook convention lost to team reality — the AI's rule
was right in general and wrong for us.

**Stopping the audit spiral.** After several rounds of "review everything and
find problems," every new prompt kept returning new findings, and I asked the
honest question: are these actually major, or should I stop? Working through
the severity of the full list myself, the pattern was clear — the early
rounds caught real defects (a dead route on every priority-queue row, the
renewal hole), but later rounds were increasingly documentation drift and
cosmetic wording, and in several cases the audit flagged my *code* when
investigation proved the code was right and the doc was stale. I stopped
auditing. Review has an asymptotic tail, and each round was digging one
severity level lower on software that three adversarial passes had already
failed to break. Recognising diminishing returns — and not treating "the AI
found something" as equivalent to "something is wrong" — was the single
biggest judgment shift of the project for me.

**Refusing a suggested clean-up that would have broken migrations.** An audit
flagged two migration files sharing a duplicate `025_` prefix. The tidy fix —
renaming one — looks free, but our `migrate.js` tracks applied migrations by
filename, so renaming an already-applied file would re-run it (or wedge the
tracker) on every database that had already applied it, including my
teammates'. The prefix stays wrong, and documented. Cosmetic consistency is
not worth a broken migration pipeline.

**Feature restraint ran both ways.** Near the end I proposed adding a built-in
calculator so managers could run their own numbers on the dashboard data. The
counter-argument — the CSV export already gives power users Excel, and the
dashboard's whole job is to do the calculating *for* the manager, so a generic
calculator quietly admits the analytics failed to answer the question — was
better than my idea, and I dropped it. I include this on the "modified"
side deliberately: critical use of AI isn't only rejecting its suggestions,
it's also letting a well-argued case beat your own instinct. The discipline
is the same in both directions — the argument wins, not the author.

**Scope and authorship discipline.** When fixes strayed into files that
belong to teammates by blame — the shared auth context, another member's
error screen — I made sure those changes were surfaced and attributed rather
than silently folded into my own work, and one suggested change that
contradicted a teammate's design decision was raised with the team instead of
merged. In a five-person repo, "the AI wrote a correct fix" is not sufficient
grounds to land it; whose folder it lands in, and who gets to decide, still
matter.

## What I take from it

The clearest pattern across the whole project: AI was strongest where its output
was immediately checkable — a failing test, a reproducible white screen, a
port that is either free or isn't — and weakest where correctness depended on
context it couldn't see, like our team's branching norms, which findings were
worth fixing this close to a deadline, or what a migration rename does to
databases that have already applied it. So that became my working rule:
before accepting an answer, ask which kind of question I just asked. If it's verifiable, verify
it and move on; if it's a judgment call, the judgment is mine.

The deeper change is in how I treat confidence — my own and the machine's. A
green test suite, a passing build, and a safety guard that prints nothing can
all be lying to you in exactly the way the blank dashboard and the silent
port guard were. What this project trained me to do is distrust silence:
make loading states explicit instead of defaulting, make crashes speak
through error boundaries instead of vanishing, and test the safety nets
themselves. That habit came out of the struggle, not the successes — and it's
the thing I'll still be using long after this codebase is archived.
