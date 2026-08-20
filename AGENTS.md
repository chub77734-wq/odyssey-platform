# Odyssey WEBSITE working agreement

This repository is the Odyssey Track Club public website and athlete portal.

## Project shape

- The site is static HTML, CSS, and JavaScript; there is no build step.
- `index.html` is the public marketing page.
- `portal.html` and `portal.js` contain the athlete portal experience.
- `styles.css` contains shared styling.
- `supabase-setup.sql` defines the portal schema, row-level security policies,
  coach authorization helper, and private storage bucket policies.
- `supabase-billing-setup.sql` is the separately reviewed Stripe billing schema.
- `supabase/functions/` contains server-side Stripe session and webhook handlers.
- Images live in `images/`.
- GitHub Pages publishes the root of `main`.

## How to work here

1. Inspect the current branch, working tree, and relevant files before editing.
2. Preserve unrelated user changes and keep each change focused.
3. Explain the intended change in plain language when requirements are ambiguous.
4. After editing, run the checks below and review the complete diff.
5. Summarize changed files, checks, and any remaining risks for the user.
6. Do not commit, push, publish, or change GitHub settings unless the user explicitly asks.
7. When asked to prepare a commit, propose a commit message and show the final diff/status first.
8. When asked to commit, commit only the reviewed files. Push only after a separate explicit request.

## Roles and dispatch

- ORION/main owns requirements, task decomposition, shared-boundary assignments,
  conflict resolution, final review, and integration. It is the only role that may
  authorize a final integration action after user approval.
- Route independent customer-facing work to ALPHA: public pages, portal presentation
  and interaction design, content, visual styling, accessibility, responsive behavior,
  and browser-facing validation.
- Route backend work to BETA: Supabase/Postgres, authentication and authorization,
  Stripe and billing, security, migrations, concurrency and idempotency, and contract
  or runtime validation.
- ORION/main must assign ownership before work begins on shared-boundary files such as
  `portal.js`, `portal.html`, shared contracts, or billing UI that depends on backend
  state. ALPHA and BETA must never edit the same file concurrently unless ORION/main
  first gives one role exclusive ownership or divides the work into non-overlapping files.
- Use isolated Git worktrees for parallel write-heavy tasks. Read-only investigation may
  share a worktree, but each writer must confirm its branch, worktree, and owned file list.
- Preserve unrelated changes, including another agent's uncommitted work. Do not stage,
  rewrite, discard, or incorporate files outside the assigned scope.
- Use the dispatch and handoff formats in `AGENT_WORKFLOW.md`. A subagent handoff is
  evidence for ORION/main to review, not authorization to integrate or release.

## Checks

- Run `git diff --check`.
- Run `node --check script.js`.
- Run `node --check portal.js`.
- Start a local static server when browser verification is needed; do not test
  pages through `file://` when authentication redirects or URL handling matter.
- For visual or interaction changes, open the affected page locally and check desktop and mobile layouts.
- Confirm that links, forms, authentication states, and browser console behavior affected by the change still work.

## Supabase work

- Treat changes to `portal.js` or `supabase-setup.sql` as security-sensitive.
- Before implementing Supabase behavior, verify the current Supabase docs and
  relevant breaking changes instead of relying on remembered API behavior.
- The browser may contain only the project's publishable key. Never add a
  secret key, legacy `service_role` key, database password, or private user data.
- Keep row-level security enabled on every exposed table. Every policy must
  enforce the athlete/coach ownership model; `to authenticated` alone is not
  authorization.
- Review `security definer` functions, grants, `search_path`, storage paths,
  and both `using` and `with check` clauses deliberately before changing them.
- Do not apply SQL to the live Supabase project unless the user explicitly asks.
  For schema work, show the SQL diff and explain migration and rollback risk
  before any remote action.
- Portal verification should cover athlete and coach roles separately. Do not
  use or expose real athlete records in screenshots, fixtures, logs, or reports.
- Keep Stripe secret keys, webhook secrets, customer IDs, and price configuration
  server-side. Card collection must remain on Stripe-hosted pages.
- Treat date of birth, guardian linkage, and minor billing exceptions as restricted
  authorization data. Athletes cannot edit billing DOB, and guardian accounts must
  remain billing-only unless the user explicitly approves a different access model.
- Billing enablement is coach-controlled and defaults off. One-off invoices must remain
  draft/`auto_advance=false` until a separate exact-ID confirmation action; never merge
  draft creation and finalization into one implicit workflow.
- Enforce all roles, prices, entitlements, ownership, capacity, and billing state
  transitions at a server-side trust boundary. Browser-supplied identifiers and claims
  are requests to validate, never authority.
- Rehearse schema, RLS, function, webhook, retry, concurrency, and billing changes with
  synthetic data in an explicitly approved non-production environment before requesting
  any production action. Record exact commands, environment, and results.

## Guardrails

- Never add secrets, credentials, private athlete data, or local environment files to Git.
- Never weaken authentication, RLS, storage policies, or coach-role checks to
  make a client-side error disappear.
- Do not rewrite Git history or discard working-tree changes without explicit approval.
- Treat `.DS_Store` as local macOS metadata, not project content.
- Keep the public MVP and athlete portal usable without introducing a build dependency unless the user approves that architectural change.
- Neither ALPHA nor BETA may commit, push, merge, deploy, publish, mutate production, or
  use live payment mode without explicit final authorization for that exact action.
