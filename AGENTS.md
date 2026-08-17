# Odyssey WEBSITE working agreement

This repository is the Odyssey Track Club public website and athlete portal.

## Project shape

- The site is static HTML, CSS, and JavaScript; there is no build step.
- `index.html` is the public marketing page.
- `portal.html` and `portal.js` contain the athlete portal experience.
- `styles.css` contains shared styling.
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

## Checks

- Run `git diff --check`.
- Run `node --check script.js`.
- Run `node --check portal.js`.
- For visual or interaction changes, open the affected page locally and check desktop and mobile layouts.
- Confirm that links, forms, authentication states, and browser console behavior affected by the change still work.

## Guardrails

- Never add secrets, credentials, private athlete data, or local environment files to Git.
- Do not rewrite Git history or discard working-tree changes without explicit approval.
- Treat `.DS_Store` as local macOS metadata, not project content.
- Keep the public MVP and athlete portal usable without introducing a build dependency unless the user approves that architectural change.
