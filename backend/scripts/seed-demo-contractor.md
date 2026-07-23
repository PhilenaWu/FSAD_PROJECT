# Seed a demo contractor login (for UC-004 close + UC-010 portal demos)

**Why this is a doc, not a `.sql` seed:** `users.id` is
`REFERENCES auth.users(id)` (migration 001), so a `users` row can only exist for
a real Supabase Auth user. Our seed migrations (e.g. `016_seed_reference_data.sql`)
can't create auth users, and this project intentionally has **no Supabase service
key** (least privilege). So the auth user is created via Supabase first, then a
tiny SQL step inserts the profile row and links it to a seeded contractor.

> **Coordinate with the UC-012 owner (Hasini):** `vendorController.onboard()` is
> the real path that "creates contractors + users rows". This demo seed does the
> same thing by hand for one vendor. Use the distinct email below so it never
> collides with onboarding tests, and let them know it exists.

## Step 1 — Create the Supabase auth user
In the Supabase dashboard → **Authentication → Users → Add user**, create:

- **Email:** `demo.contractor@estatecare.test` (distinct — do not reuse a real vendor email)
- **Password:** any demo password (share with the team out-of-band)
- Confirm the user so it can log in.

Copy the new user's **UID** (a UUID) — call it `<AUTH_UID>` below.

*(Alternatively, from the client: `supabase.auth.signUp({ email, password })` with
that email, then grab the id from the returned session.)*

## Step 2 — Insert the profile row + link the contractor
Run this in the Supabase SQL editor (or add it as a **local-only** seed you don't
commit with a real UID). It links the login to the "Otis Service SG" contractor
seeded in `016_seed_reference_data.sql`.

```sql
-- Replace <AUTH_UID> with the UID from Step 1.
INSERT INTO users (id, email, full_name, role, status)
VALUES ('<AUTH_UID>', 'demo.contractor@estatecare.test', 'Demo Contractor', 'contractor', 'active')
ON CONFLICT (id) DO NOTHING;

-- Back-reference on the contractor record (contractors.user_id → users.id).
UPDATE contractors
   SET user_id = '<AUTH_UID>'
 WHERE name = 'Otis Service SG';
```

## Step 3 — Use it
- **UC-004 close (resident complaint):** assign the complaint to *Otis Service SG*,
  then on the detail page pick **Contractor** as the endorser — its `endorser_id`
  is now `<AUTH_UID>`, a valid `users` row, so the second signature stores cleanly.
- **UC-010 (Zoe):** this account can log in as a contractor and join the
  `contractor-<AUTH_UID>` socket room.

**Note:** the primary UC-004 demo path (a **lift inspection**, inspector +
manager) needs none of this — the inspector is already `inspection.inspector_id`.
This seed only unlocks dual-close for **resident complaints**.
