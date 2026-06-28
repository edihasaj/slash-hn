# slash-hn

Local Hacker News CLI for commenting from the command line — a sibling of
[`slash-x`](https://github.com/edihasaj/slash-x) and
[`slash-reddit`](https://github.com/edihasaj/slash-reddit).

Uses your existing news.ycombinator.com browser cookie by default. HN has no
write API, so comments still go through the web comment form. Username/password
login remains supported as a fallback. Reading uses the official Firebase API.

## Install
```bash
cd ~/Projects/slash-hn && npm link    # exposes `slash-hn` and `shn`
```

## Auth
Default auth reads your existing HN browser login from Safari, Chrome, Edge, or
Firefox:
```bash
slash-hn check
```

For launch agents or bridge services, pass a cookie explicitly:
```bash
export HN_COOKIE_HEADER='user=...'
# or only:
export HN_USER_COOKIE=...
```

Useful cookie options:
```bash
slash-hn check --cookie-source chrome
slash-hn check --cookie-source safari --cookie-source firefox
slash-hn check --chrome-profile "Default"
```

Password fallback:
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
`--cookie`, `--user-cookie`, `--cookie-source`, `--username`, `--password`.
