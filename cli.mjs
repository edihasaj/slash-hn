#!/usr/bin/env node
// slash-hn — Edi's local Hacker News CLI. Comment / reply on HN.
// HN has no write API, so this logs in and uses the comment form (like the web UI).

const BASE = "https://news.ycombinator.com";

const HELP = `slash-hn — comment on Hacker News from the command line

Usage:
  slash-hn comment <item> <text>     Comment on a story or reply to a comment
  slash-hn comment <item> --file f   Read the body from a file
  slash-hn read <item>               Show an item (title/text)
  slash-hn whoami                    Show the logged-in user
  slash-hn check                     Verify login

<item> can be an HN item URL or a numeric id. Replying to a comment? Pass that
comment's id (the form parents to whatever id you give).

Auth:  HN_USERNAME, HN_PASSWORD   (or --username / --password)

Options:
  --file <path>   Read body text from a file
  --json          Machine-readable JSON output

Examples:
  slash-hn comment https://news.ycombinator.com/item?id=48400000 "Great point — …"
  slash-hn comment 48400000 --file reply.md --json
`;

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); if (k === "json") out.flags.json = true; else out.flags[k] = argv[++i]; }
    else out._.push(a);
  }
  return out;
}

function cfg(flags) {
  return {
    username: flags.username || process.env.HN_USERNAME || "",
    password: flags.password || process.env.HN_PASSWORD || "",
    cookie: "",
  };
}

function itemId(ref) {
  ref = String(ref).trim();
  const m = /id=(\d+)/.exec(ref) || /\/item\/(\d+)/.exec(ref);
  if (m) return m[1];
  if (/^\d+$/.test(ref)) return ref;
  throw new Error(`could not find an HN item id in "${ref}"`);
}

async function login(c) {
  if (!c.username || !c.password) throw new Error("Missing credentials: set HN_USERNAME and HN_PASSWORD.");
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "slash-hn/0.1" },
    body: new URLSearchParams({ acct: c.username, pw: c.password, goto: "news" }),
    redirect: "manual",
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const userCookie = set.map((s) => s.split(";")[0]).find((s) => s.startsWith("user="));
  if (!userCookie) {
    const body = await res.text();
    if (body.includes("Bad login")) throw new Error("HN login failed (bad username/password).");
    throw new Error("HN login failed (no session cookie returned).");
  }
  c.cookie = userCookie;
  return c;
}

async function getHmac(c, id) {
  const res = await fetch(`${BASE}/item?id=${id}`, { headers: { cookie: c.cookie, "user-agent": "slash-hn/0.1" } });
  const html = await res.text();
  const m = /name="hmac"\s+value="([^"]+)"/.exec(html);
  if (!m) throw new Error("could not find the comment form (is the item locked, or are you logged in?)");
  return m[1];
}

async function readBody(parsed, idx) {
  if (parsed.flags.file) { const { readFile } = await import("node:fs/promises"); return (await readFile(parsed.flags.file, "utf8")).trim(); }
  return (parsed._[idx] || "").trim();
}

function done(parsed, obj) {
  if (parsed.flags.json) console.log(JSON.stringify(obj, null, 2));
  else if (obj.success) console.log(`✅ ${obj.message || "done"}${obj.url ? `\n🔗 ${obj.url}` : ""}`);
  else console.error(`❌ ${obj.error}`);
  process.exit(obj.success ? 0 : 1);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const cmd = parsed._[0];
  if (!cmd || cmd === "help" || parsed.flags.help) { console.log(HELP); process.exit(0); }
  const c = cfg(parsed.flags);
  try {
    if (cmd === "read") {
      const id = itemId(parsed._[1] || "");
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((x) => x.json());
      if (!r) throw new Error("item not found");
      return done(parsed, { success: true, message: (r.title || r.text || "").replace(/<[^>]+>/g, " ").slice(0, 300),
        by: r.by, score: r.score, url: `${BASE}/item?id=${id}` });
    }
    if (cmd === "whoami" || cmd === "check") {
      await login(c);
      return done(parsed, { success: true, message: `logged in as ${c.username}`, user: c.username });
    }
    if (cmd === "comment" || cmd === "reply") {
      const id = itemId(parsed._[1] || "");
      const text = await readBody(parsed, 2);
      if (!text) throw new Error("empty comment (pass <text> or --file)");
      await login(c);
      const hmac = await getHmac(c, id);
      const res = await fetch(`${BASE}/comment`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: c.cookie, "user-agent": "slash-hn/0.1" },
        body: new URLSearchParams({ parent: id, goto: `item?id=${id}`, hmac, text }),
        redirect: "manual",
      });
      if (res.status >= 400) throw new Error(`HN returned ${res.status}`);
      return done(parsed, { success: true, message: "comment posted", url: `${BASE}/item?id=${id}` });
    }
    throw new Error(`unknown command "${cmd}" (try: slash-hn help)`);
  } catch (e) {
    return done(parsed, { success: false, error: String(e.message || e) });
  }
}

main();
