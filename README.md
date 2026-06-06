# slash-hn

Local Hacker News CLI for commenting from the command line — a sibling of
[`slash-x`](https://github.com/edihasaj/slash-x) and
[`slash-reddit`](https://github.com/edihasaj/slash-reddit).

Dependency-free single file. HN has no write API, so this logs in and uses the
comment form (exactly like the web UI). Reading uses the official Firebase API.

## Install
```bash
cd ~/Projects/slash-hn && npm link    # exposes `slash-hn` and `shn`
```

## Auth
```bash
export HN_USERNAME=yourname
export HN_PASSWORD=...
slash-hn check
```

## Use
```bash
# comment on a story, or reply to a comment (pass the comment's id)
slash-hn comment https://news.ycombinator.com/item?id=48400000 "Great point — …"
slash-hn comment 48400000 --file reply.md --json
slash-hn read 48400000
```

| Command | Description |
| --- | --- |
| `comment <item> [text]` | Comment on a story or reply to a comment |
| `read <item>` | Show an item's title/text |
| `whoami` / `check` | Show / verify login |

`<item>` is an HN item URL or numeric id. Options: `--file <path>`, `--json`,
`--username`, `--password`.
