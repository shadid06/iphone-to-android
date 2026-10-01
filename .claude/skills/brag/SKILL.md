---
name: brag
description: Turn recent git work into brag-document bullets (impact-focused accomplishments for reviews, standups, or a running brag doc). Use when the user runs /brag or asks "what did I ship", "write my brag doc", or "summarize my accomplishments".
argument-hint: "[since, e.g. '1 week ago' | '2026-09-01' | commit range]  (default: 2 weeks ago)"
allowed-tools: Bash(git log:*), Bash(git show:*), Bash(git diff:*), Bash(git config:*), Read, Grep, Glob, Edit, Write
---

# /brag

Produce brag-document entries from the user's own commits.

## Steps

1. **Range.** Use `$ARGUMENTS` as the `--since` value (or a commit range if it contains `..`). Default: `2 weeks ago`.
2. **Author.** `git config user.name` / `user.email`. Only count commits by that author.
3. **Collect.** `git log --author=<author> --since=<range> --no-merges --stat --format='%h %ad %s' --date=short`. For commits with vague messages (e.g. "fix", "first commit"), inspect `git show --stat <sha>` and skim key diffs to learn what actually changed.
4. **Group** related commits into accomplishments (one feature/fix = one bullet, not one commit = one bullet).
5. **Write** each bullet as: **what shipped** → **why it matters** (user/business impact) → evidence (short SHAs). Lead with a strong verb. No invented metrics — if impact is unknown, state the concrete capability instead, and list it under "Fill in" so the user can add numbers.

## Output format

```markdown
## Brag — <start date> → <end date>

### Shipped
- **<Verb> <thing>** — <impact>. (`abc1234`, `def5678`)

### Fixes & reliability
- ...

### Fill in (add metrics / context)
- <bullet>: how many users? latency/crash change? who unblocked?
```

Omit empty sections.

6. **Save (optional).** If `BRAG.md` exists at the repo root, offer to prepend the new section to it; create it only if the user says yes.
