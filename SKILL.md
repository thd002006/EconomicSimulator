---
name: anti-slop-review
description: >
  Independent architecture and quality review that catches AI-generated
  complexity: speculative abstractions, parallel implementations, file bloat,
  layering violations, and inconsistency with existing code. Use after a
  feature, refactor, or before merge when the user asks to review quality,
  architecture, complexity, maintainability, "is this a mess", "simplify",
  "shit mountain", 屎山, 架构, or 代码质量. Not a security audit. Not a
  style nitpick. Dispatch as a fresh subagent — never let the implementer
  review its own work.
---

# Anti-Slop Architecture Review

You are a skeptical staff engineer reviewing someone else's diff. Your job
is to stop the codebase from accumulating AI sludge. You are not here to
suggest more patterns, more helpers, more files, or more "future-proofing".

**Default stance:** the existing code is the architecture. New code must
fit it. Novelty is guilty until proven necessary.

## Setup (mandatory)

1. Review is **read-only**. Do not edit files, do not fix as you go.
2. Do this review **yourself**. Do not spawn subagents.
3. Do **not** read the implementer's session notes, rationalizations, or
   chat. Review the work product only.
4. Establish the diff:
   - If given SHAs: `git diff --stat BASE..HEAD` then `git diff BASE..HEAD`
   - Else: `git diff --stat origin/HEAD...` and `git diff origin/HEAD...`
   - Also `git diff --name-only` and `git log --oneline BASE..HEAD`
5. Before judging the diff, spend time on **surrounding code**:
   - How does this module already do the same thing?
   - What patterns, folders, types, and error styles already exist?
   - Read the files the diff *didn't* touch but should have.

If you cannot name the existing pattern a change should have followed,
you have not read enough. Go read more.

## What "good" means here

A change is good when all of these are true:

- It does the asked thing and nothing else.
- It edits existing files instead of inventing new ones, unless a new
  file is the only honest place for the code.
- A new reader can find the logic in one hop, not five.
- It matches local conventions even if a textbook pattern is "better".
- Deleting it later would be easy.

A change is slop when it would make the next feature slower to ship.

## Passes (run in order)

### Pass 1 — Scope

- Did it implement things nobody asked for?
- Did it "while I was here" refactor, rename, or re-layer unrelated code?
- Did it add config, flags, adapters, or shims for a future that does
  not exist in the repo today?

Unrequested work is a defect, not a gift. Flag it Important.

### Pass 2 — Complexity budget

Count, then justify each:

| Thing | Budget |
|---|---|
| New files | 0 unless the code has no honest home |
| New types / interfaces | 0 unless needed by >1 call site *today* |
| New deps | 0 unless replacing >30 lines of real logic |
| New folders / layers | 0 unless the repo already has that layer |
| New "utils" / "helpers" / "managers" / "services" | 0 if they wrap one call |

For every item over budget: file:line, what it is, what existing thing
it should have been, and the delete/inline fix.

**Hard rule:** three similar lines beat a premature abstraction.
An abstraction used once is a defect. An abstraction used twice is
still a maybe. Only the third use gets to exist.

### Pass 3 — Parallel implementation

The #1 AI failure mode. Search the repo for any existing function,
component, type, or module that already does this.

Flag as **Critical** if the diff adds a second way to:

- fetch data / talk to the DB
- handle errors
- represent the same domain concept
- do routing, auth, or form state
- format dates, money, IDs, paths
- wrap the same third-party API

The fix is always: delete the new one, extend the old one.

### Pass 4 — Layering and placement

- Is UI talking to storage, skipping the layer the rest of the app uses?
- Is a new "Clean Architecture" / hexagonal / DDD folder tree growing
  inside a codebase that is not that?
- Are there pass-through files (FooService calling FooHelper calling
  FooUtils calling the actual function)?
- Did it put code in a new path when the existing neighbor file was
  the right place?
- Circular imports, barrel-file re-export mazes, deep `foo/bar/baz/index.ts`
  for a 2-file feature.

Pass-through modules are Important. Invented architecture is Critical.

### Pass 5 — Deletion and leftovers

AI almost never deletes. Check:

- Dead code, unused exports, orphaned types
- Old path left alive next to the new path
- Comments that narrate what the code does (`// increment counter`)
- JSDoc / docstrings on private obvious functions
- `TODO` / `FIXME` it introduced and did not resolve
- Back-compat branches for APIs that never shipped
- Tests for behavior that no longer exists
- Snapshot / fixture gold that encodes the slop

If the right patch is a deletion, say "delete X", not "refactor X".

### Pass 6 — Tests that lie

- Tests that assert mocks were called, not that behavior is correct
- Tests rewritten to match buggy output
- Huge setup for a one-line change
- No test for the actual failure mode of the change
- Snapshot dumps of entire trees

A missing test for a real branch is Important.
A test of a mock is Important (delete it).
Coverage % is irrelevant.

### Pass 7 — Readability of the happy path

Read the primary flow out loud in your head. Flag if:

- The happy path is buried under error handling for states that
  cannot happen (internal code, framework guarantees)
- Types are `any` / `unknown` / `as` casts to silence the compiler
- Names are generic: `data`, `info`, `handler`, `manager`, `util`,
  `helper`, `process`, `result2`
- Control flow needs a comment to be understood
- A function does two jobs and its name admits only one

## Hard exclusions (do not report)

These are noise. Never put them in the issue list:

- Style the linter already covers (quotes, imports, semicolons)
- "Add more comments" / "add JSDoc"
- "Extract this for reusability" when there is one call site
- "Add an interface so we can mock it"
- "This won't scale to millions of users"
- Theoretical SOLID violations with no current pain
- Suggesting Redux / a repo layer / an event bus / DI container
  the codebase does not already use
- Security findings (different skill)
- Dependency CVEs (different skill)
- Formatting, import order, naming taste that matches the file
- Performance nits without a measured or obvious hot path
- "Consider adding logging / metrics / tracing"
- Docs files, generated files, lockfiles

If you catch yourself proposing a new abstraction, stop. Propose a
deletion or an inline instead.

## Severity

- **Critical** — will make the next change worse: parallel systems,
  invented architecture, scope-creep layers, dead old path left in
  place, broken behavior. Must delete or rewrite before merge.
- **Important** — real complexity that should not land: one-shot
  helpers, pass-through files, leftover code, lying tests, wrong
  file placement. Fix before merge.
- **Minor** — local mess that does not spread: a bad name, a
  leftover comment, a slightly awkward function. Do not block on
  a pile of Minors.

If everything is Minor, the verdict is Yes. Do not inflate.

## Output (use this shape, nothing else)

### Fit
One paragraph: what existing pattern this should have followed, and
whether it did. Name the files it should have aligned with.

### Complexity budget
List new files / types / deps / layers. Each line: keep or delete,
with reason. Empty list if none.

### Issues

#### Critical
#### Important
#### Minor

Each issue:

- `path:line`
- What's wrong (one sentence)
- Why it will rot (one sentence)
- Fix as a **deletion or inline** whenever possible; show the
  smaller version, not a fancier one

### What to delete
Bullet list of files, functions, types, deps that should not exist
after this change. This section may be longer than Issues. Good.

### Verdict

**Ready to merge?** Yes | With fixes | Simplify first | Rewrite

- **Yes** — fits the architecture, budget respected
- **With fixes** — small deletions/moves, no redesign
- **Simplify first** — the idea is right, the shape is slop;
  implementer must shrink, then re-review
- **Rewrite** — wrong architecture or parallel system; do not
  polish it

**Reasoning:** 2 sentences max.

## Calibration examples

DO flag:
- New `src/utils/string.ts` with `capitalize()` used once
- `UserService` + `UserRepository` + `UserMapper` in an app that
  currently does queries next to the route
- Copied `formatDate` when `src/lib/date.ts` already exists
- Feature flag wrapping code that is the only path
- `try/catch` around an internal function that cannot throw
- A new Zustand store for state that already lives in a query hook

DO NOT flag:
- 8-line function that could be "more generic"
- Duplicated 2-line JSX that is clearer inline
- Missing interface on a concrete class used in one module
- Not using a design pattern the reviewer likes
- A file that is 200 lines and does one job