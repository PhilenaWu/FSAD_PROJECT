# Seeding an admin account

Authentication is **Supabase Auth**, so the login credential (email + password)
lives in Supabase's own `auth.users` table — it can't be created by a SQL
migration. Creating an admin is therefore two steps: create the auth user in the
Supabase dashboard, then insert the matching profile row into our `users` table
with `role = 'admin'`.

Admin emails follow the `<name>@admin.com` convention. The default test account
below is `admin@admin.com`.

| Field    | Value          |
|----------|----------------|
| Email    | `admin@admin.com` |
| Password | `AdminTest123` |
| Role     | `admin`        |

## 1. Create the Supabase Auth user

In the Supabase dashboard:

1. **Authentication → Users → Add user → Create new user**.
2. Email: `admin@admin.com`, Password: `AdminTest123`.
3. Tick **Auto Confirm User** (skips the email confirmation step so the account
   can log in immediately).
4. Create, then copy the new user's **User UID** (a UUID) — you need it below.

## 2. Insert the profile row

Our `users` table keys off the Supabase auth UID (`users.id → auth.users.id`).
Run this in the **Supabase SQL editor**, pasting the UID from step 1:

```sql
INSERT INTO users (id, email, full_name, role)
VALUES (
  '<PASTE-AUTH-USER-UID-HERE>',
  'admin@admin.com',
  'Estate Admin',
  'admin'
);
```

Or, without copy-pasting the UID, look it up by email from `auth.users`:

```sql
INSERT INTO users (id, email, full_name, role)
SELECT id, email, 'Estate Admin', 'admin'
FROM auth.users
WHERE email = 'admin@admin.com';
```

## 3. Log in

Sign in at `/login` with the credentials above. The app routes `admin` to
`/admin/costs` and renders the admin layout (Cost Analytics + Vendors tabs).

> To add more admins, repeat with a different `<name>@admin.com` email.
