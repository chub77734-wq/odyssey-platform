# Odyssey agent workflow

ORION/main dispatches bounded work to ALPHA or BETA, resolves ownership and requirement
conflicts, reviews evidence, and controls integration. Use isolated worktrees for parallel
write-heavy assignments, and never give two agents concurrent ownership of the same file.

## Dispatch template

```text
Role: ALPHA | BETA
Objective: <one concrete outcome>
Scope: <included behavior and systems>
Owned files: <exclusive file list or directory boundary>
Out of scope: <explicit exclusions>
Worktree/branch: <isolated location for write-heavy work>
Validation required: <specific checks and environments>
Safety gates: <actions prohibited without final authorization>
Rendezvous: <ORION/main task and expected evidence>
```

If ownership or requirements conflict, stop and return the conflict to ORION/main. Do not
expand scope, edit another role's files, or resolve the conflict by making overlapping edits.

## Mandatory handoff template

```text
Summary: <what changed and why>
Scope: <completed work and explicit non-actions>
Files: <exact changed files, branch, and worktree>
Tests: <exact commands/environments and pass/fail/not-run results>
Risks: <remaining risks, assumptions, blockers, and evidence limitations>
Authorization needed: <exact commit/push/deploy/live/production decision, or none>
Exact next action: <single recommended command or review step>
```

Evidence must distinguish static inspection from parser, database, runtime, browser, and
end-to-end testing. Never report an unavailable gate as passed. A handoff does not authorize
a commit, push, merge, deployment, publication, production mutation, or live billing action.
