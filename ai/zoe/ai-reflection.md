# AI Reflection — Zoe

## UC-003 · UC-008 · UC-010

My work on this project was the real-time layer and the two features built on
top of it: the notification system (UC-008), the contractor portal (UC-010),
and the originator status tracker (UC-003). I used Claude Code throughout. It
was useful, but not evenly, and the pattern of where it helped and where I had
to override it was consistent enough that I can describe it precisely.

## Where AI added value

**Building one thing instead of three.** My first commit was a shared
Socket.IO foundation rather than a feature. Three use cases on the board needed
live updates, and each of us could have added our own. Working through the
design with AI helped me settle the seam early: `initSocket`/`getIO`, one
`socketService.emitToRoom` that controllers call, and role rooms joined
automatically at handshake time. The value was not the code, which is short. It
was having something to argue with while deciding what the boundary should be
before three branches hardened around three different answers.

**Coverage sweeps against real code.** The most consistently useful thing was
pointing it at a file and asking what was untested. That is checkable work, and
it found gaps I would not have. The clearest example came late: while adding
notification assertions to the contractor tests, it turned out
`contractor.test.js` had never returned an inserted notification row from its
database mock. Because `notifyEvent` is designed to swallow its own failures,
every notification in that suite was failing silently and no test had ever
observed one. The suite was green and had been telling me nothing about
notifications for weeks. That is a failure mode I would not have gone looking
for, because passing tests do not invite suspicion.

**Finding pre-existing breakage while working on something else.** When I built
the notification persistence layer, two problems on `main` surfaced that had
nothing to do with my branch: `MyReportsPage.jsx` declared `useAuth` and
`profile` twice from a bad merge, which broke `vite build` outright, and
`myReports.integration.test.js` mocked three of `cvController`'s five exports,
so Express threw on an undefined route handler at require time and the suite
failed before a single test ran. Both were quick to fix once seen. Neither was
mine, and neither was visible from the feature I was actually building.

**Library and DOM friction.** Writing the frontend tests at the end, most of my
time went on Material UI's rendered DOM rather than my own logic: an outlined
`TextField` duplicates its label into the fieldset legend once it has a value,
so `getByLabelText` matches the same input twice and throws; a closing MUI
dialog leaves `aria-hidden` on the page during its exit transition, so a
`getByRole` query fired right afterwards finds nothing. Hypothesise, test
against the real DOM, correct — that loop was much faster with an assistant
than reading library source. I wrote both up in the test folder README so
nobody else loses the same hours.

## Where I rejected or changed what it suggested

**Auth.** Anything touching authentication produced `bcrypt`, `jsonwebtoken`, a
`password_hash` column and `/api/auth/login|register` routes. We use Supabase
Auth on the client and verify the token on the server. Accepting that would
have meant two identity systems and duplicate password storage. It resurfaced
often enough that the team wrote the prohibition into `AGENTS.md` so the
constraint lives in the repo rather than in whoever is reviewing.

**Trusting a client-supplied room name.** For the UC-003 detail view I added an
`insp-{id}` socket room so a record's originator gets updates about their own
record instead of only the block-wide feed. The straightforward implementation
joins whatever room the client asks for. I did not do that: `canJoinRecordRoom()`
checks the caller against `resident_id`/`inspector_id`, because a room name
arriving from the client is a request, not a grant. I also added a UUID shape
check before the database call, since a malformed id rejecting inside an async
socket handler is an unhandled rejection, and that takes the process down
rather than failing one request. The same instinct drove returning 404 rather
than 403 on another resident's record — a 403 confirms the record exists.

**Not adding a status.** The hold flow could have been an `On Hold` status with
a transition into it. I kept the defect at `Assigned` and stored the hold as a
fact on the record (`hold_reason`, cleared on resume). Adding a status would
have meant changing the migration 004 CHECK constraint, backfilling rows, and
touching every SLA, overdue and analytics query that matches on status,
including work that is not mine. It also would not have been true: the
contractor still owns the job while it is paused. Relatedly, I had to correct
the assumption that a held defect keeps accruing overdue time. Under G11 a hold
pauses the deadline, so held records are excluded from the overdue and due-soon
buckets. That rule lives in the design docs, not in the file on screen.

**Sending fewer notifications, not more.** The default instinct — mine and the
model's — is that another audience should also be told. Working through the
UC-008 defect list I went the other way. Contractor transitions had been two
`notifyEvent` calls, managers then originator, which wrote two rows per event
so anyone in both audiences saw it twice; I replaced that with one call through
a `managers_and_users` scope that unions and dedupes the ids before they reach
the recipient insert, which makes the overlap structurally impossible rather
than merely unlikely. I also deliberately stopped notifying the resident on
contractor-side transitions, because the only room available was `block-{n}` —
every resident of the block would have received a live message about one
household's defect while only the originator got a durable row. And a partial
save still notifies nobody, because a durable row per save buries the bell.

**Keeping a design rule I could not implement cleanly.** The bell chips needed
colour by event type. The obvious route is the theme's palette, but the
automation colour I wanted has no palette entry and the nearest option,
`secondary` purple, sits too close to `primary` blue to distinguish at chip
size. I applied the colour through `sx` with an explicit value instead and
wrote down why, rather than accepting a colour that technically fits the system
but does not read.

**Scope discipline.** Several things stayed unfixed on purpose and are recorded
as such. "Mark all read" fans out one PATCH per unread row because there is no
bulk endpoint, and at inbox size that is fine and keeps the change
frontend-only. `notifications.manager_id` is really an author column now that
contractors send too, but renaming it touches `findByManager`, the history
query and a migration, so it stays wrong and documented. An inspector or admin
typing `/notifications` directly still gets the manager composer, which is
unreachable by clicking and not that branch's to fix. I also flagged, rather
than quietly reversed, that giving contractors the staff contact list
contradicts a rule stated in a teammate's route — that needed raising with her,
not deciding alone.

## What I take from it

The split is clean enough that I use it as a rule now. AI was strongest where I
could verify the answer immediately: tests, library behaviour, listing edge
cases, and spotting breakage adjacent to what I was working on. It was weakest
where the constraint was written somewhere else — a design-doc rule like G11, a
decision another member had already made in their own file, or a table that
five other queries depend on. Those are exactly the cases where a confident
answer is most expensive, because it looks finished.

The habit I actually built was smaller than "learning to prompt". It was
checking which kind of question I was asking before I accepted the answer, and
treating a green test suite as a claim to verify rather than a result.
