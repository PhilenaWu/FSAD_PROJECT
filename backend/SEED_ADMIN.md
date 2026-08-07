# Admin accounts

The admin logins are seeded by `migrations/037_seed_admin.sql`, the same way the
inspector, manager and resident logins are (029 / 032). Both the Supabase auth
row (`auth.users` + `auth.identities`) and the profile row (`users`, with
`role = 'admin'`) are created by the migration, so the credentials live entirely
in the database — there is nothing to create by hand.

Run the migrations from `backend/`:

```bash
npm run migrate
```

| Name           | Email                            | Password        |
|----------------|----------------------------------|-----------------|
| Steven Tan     | `steven.tan.admin@emservices.sg` | `ChocoPizza_54` |
| Sophia Collins | `sophia_collins@admin.com`       | `TempPass123!`  |

Sign in at `/login`. The app routes `admin` to `/admin/costs` and renders the
admin layout (Cost Analytics + Vendors tabs).

> Sophia's account predates this migration and was created by hand, so on our
> shared database her original password still stands — the literal above only
> applies to a **fresh** database. The migration is idempotent and never
> overwrites an existing account's password. Passwords are bcrypt-hashed by
> Supabase and cannot be read back; reset a forgotten one from
> **Authentication → Users** in the Supabase dashboard.

## Adding another admin

Add a `(email, full name, password)` row to the `VALUES` list in
`037_seed_admin.sql` and re-run the migrations; existing accounts are left
alone. Either address convention works — `<name>.admin@emservices.sg` matches
the other staff roles, `<name>@admin.com` is what the earlier admin used.
