# Issue tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues. Use the `gh` CLI for issue operations after a GitHub remote has been configured and authentication is available.

## Conventions

- Create: `gh issue create --title "..." --body-file <file>`.
- Read: `gh issue view <number> --comments --json number,title,body,labels,comments,url`.
- List: `gh issue list --state open --json number,title,body,labels,url` with explicit label and state filters.
- Comment: `gh issue comment <number> --body-file <file>`.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Prefer `--body-file` over shell-embedded multiline content. Never publish secrets, raw environment values, unreviewed traces, or private repository data in an issue.

## Skill meanings

- “Publish to the issue tracker” means create a GitHub issue.
- “Fetch the relevant ticket” means read the issue, its labels, and its comments.

Until a remote exists, prepare issue bodies locally under `docs/planning/`; do not silently substitute a second local issue tracker.

