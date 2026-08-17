# Odyssey Track Club — Public MVP

This is a responsive static launch site. No build tools are required.

## Publish with GitHub Pages

1. Upload `index.html` to the root of the `odyssey-platform` repository.
2. In GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select `main` and `/ (root)`, then save.
5. GitHub will display the published URL after deployment completes.

## Replace before public promotion

- Final Odyssey logo
- Exact training days, times, and location
- Contact email or application form link
- Social links
- Privacy and payment terms before enabling subscriptions

## Scope

The public marketing site and authenticated training portal live in this repository.
The portal supports athlete profiles, coach-assigned workouts, private dialogue, and
file attachments through Supabase.

## Portal setup

1. Open the Supabase SQL Editor for the project configured in `portal.js`.
2. Review and run `supabase-setup.sql` once.
3. In Supabase Authentication, create or invite the coach account.
4. Confirm that `odysseytrackclub@gmail.com` exists as an Authentication user,
   then run the final coach-registration statement.
5. Invite athletes through Supabase Authentication. Each athlete completes their
   profile after accepting the invitation.

The `portal-files` bucket is private. Row-level security limits athletes to their
own profile, workouts, messages, and file folder; coaches can manage every athlete.
