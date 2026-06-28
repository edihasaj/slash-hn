#!/usr/bin/env node
// slash-hn — Edi's local Hacker News CLI. Comment / reply on HN.
// HN has no write API, so this logs in and uses the comment form (like the web UI).

import { getCookies } from "sweet-cookie-local";

const BASE = "https://news.ycombinator.com";
const HN_COOKIE_NAMES = ["user"];
const DEFAULT_COOKIE_TIMEOUT_MS = 30_000;

const HELP = `slash-hn — comment on Hacker News from the command line

Usage:
  slash-hn comment <item> <text>     Comment on a story or reply to a comment
  slash-hn comment <item> --file f   Read the body from a file
  slash-hn read <item>               Show an item (title/text)
  slash-hn whoami                    Show the logged-in user
  slash-hn check                     Verify login

<item> can be an HN item URL or a numeric id. Replying to a comment? Pass that
comment's id (the form parents to whatever id you give).

Auth:
  Default: browser cookie from news.ycombinator.com (Safari, Chrome, Edge, Firefox)
  Fallback: HN_USERNAME, HN_PASSWORD (or --username / --password)

Options:
  --file <path>             Read body text from a file
  --cookie <header>         HN Cookie header
  --user-cookie <value>     HN user cookie value
  --cookie-source <name>    safari | chrome | edge | firefox (repeatable)
  --chrome-profile <name>   Chrome profile name/path
  --edge-profile <name>     Edge profile name/path
  --firefox-profile <name>  Firefox profile name/path
  --json                    Machine-readable JSON output

Examples:
  slash-hn comment https://news.ycombinator.com/item?id=48400000 "Great point — …"
  slash-hn comment 48400000 --file reply.md --json
`;

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (k === "json" || k === "help") out.flags[k] = true;
      else if (k === "cookie-source") {
        const value = argv[++i];
        if (!out.flags[k]) out.flags[k] = [];
        out.flags[k].push(value);
      } else out.flags[k] = argv[++i];
    }
    else out._.push(a);
  }
  return out;
}

function env(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function cfg(flags) {
  return {
    username: flags.username || env("HN_USERNAME"),
    password: flags.password || env("HN_PASSWORD"),
    explicitLogin: Boolean(flags.username || flags.password),
    cookie: flags.cookie || env("HN_COOKIE_HEADER") || env("HN_COOKIE"),
    userCookie: flags["user-cookie"] || env("HN_USER_COOKIE"),
    cookieSource: flags["cookie-source"],
    chromeProfile: flags["chrome-profile"] || env("HN_CHROME_PROFILE"),
    edgeProfile: flags["edge-profile"] || env("HN_EDGE_PROFILE"),
    firefoxProfile: flags["firefox-profile"] || env("HN_FIREFOX_PROFILE"),
    cookieTimeoutMs: Number(flags["cookie-timeout-ms"] || env("HN_COOKIE_TIMEOUT_MS") || DEFAULT_COOKIE_TIMEOUT_MS),
  };
}

function normalizeSource(source) {
  if (["safari", "chrome", "edge", "firefox"].includes(source)) return source;
  return "";
}

function sources(flagsValue) {
  const requested = Array.isArray(flagsValue) ? flagsValue : flagsValue ? [flagsValue] : [];
  const normalized = requested.map(normalizeSource).filter(Boolean);
  return normalized.length ? normalized : ["safari", "chrome", "edge", "firefox"];
}

function labelForSource(source, profile) {
  if (source === "safari") return "Safari";
  if (source === "chrome") return profile ? `Chrome profile "${profile}"` : "Chrome default profile";
  if (source === "edge") return profile ? `Edge profile "${profile}"` : "Edge default profile";
  return profile ? `Firefox profile "${profile}"` : "Firefox default profile";
}

function hnUserFromCookie(cookieHeader) {
  const m = /(?:^|;\s*)user=([^;]+)/.exec(cookieHeader || "");
  if (!m) return "";
  const raw = decodeURIComponent(m[1]).replace(/^"|"$/g, "");
  return raw.split("&")[0] || "";
}

function pickCookie(cookies) {
  const hit = cookies.find((cookie) => cookie?.name === "user" && typeof cookie.value === "string" && cookie.value);
  return hit?.value ? `user=${hit.value}` : "";
}

async function browserCookie(c) {
  const warnings = [];
  for (const source of sources(c.cookieSource)) {
    const profile = source === "firefox" ? c.firefoxProfile : source === "edge" ? c.edgeProfile : c.chromeProfile;
    const { cookies, warnings: providerWarnings } = await getCookies({
      url: `${BASE}/`,
      origins: [`${BASE}/`],
      names: [...HN_COOKIE_NAMES],
      browsers: [source],
      mode: "merge",
      chromeProfile: source === "chrome" ? c.chromeProfile : undefined,
      edgeProfile: source === "edge" ? c.edgeProfile : undefined,
      firefoxProfile: source === "firefox" ? c.firefoxProfile : undefined,
      timeoutMs: Number.isFinite(c.cookieTimeoutMs) && c.cookieTimeoutMs > 0 ? c.cookieTimeoutMs : DEFAULT_COOKIE_TIMEOUT_MS,
    });
    warnings.push(...providerWarnings);
    const cookie = pickCookie(cookies);
    if (cookie) return { cookie, source: labelForSource(source, profile), warnings };
  }
  return { cookie: "", source: "", warnings };
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

async function auth(c) {
  if (c.explicitLogin) return login(c);
  if (c.cookie || c.userCookie) {
    const fromHeader = Boolean(c.cookie);
    c.cookie = c.cookie || `user=${c.userCookie}`;
    c.username ||= hnUserFromCookie(c.cookie);
    c.auth = "cookie";
    c.source = fromHeader ? "Cookie header" : "user cookie";
    return c;
  }
  const fromBrowser = await browserCookie(c);
  if (fromBrowser.cookie) {
    c.cookie = fromBrowser.cookie;
    c.username ||= hnUserFromCookie(c.cookie);
    c.auth = "cookie";
    c.source = fromBrowser.source;
    return c;
  }
  if (c.username && c.password) return login(c);
  throw new Error([
    "Missing HN auth.",
    "Login to news.ycombinator.com in Safari/Chrome/Edge/Firefox, or set HN_COOKIE_HEADER / HN_USER_COOKIE.",
    "Username/password fallback is still supported with HN_USERNAME/HN_PASSWORD.",
    ...fromBrowser.warnings.slice(0, 3),
  ].join(" "));
}

async function getHmac(c, id) {
  const res = await fetch(`${BASE}/item?id=${id}`, { headers: { cookie: c.cookie, "user-agent": "slash-hn/0.1" } });
  const html = await res.text();
  const m = /name="hmac"\s+value="([^"]+)"/.exec(html);
  if (!m) throw new Error("could not find the comment form (is the item locked, or are you logged in?)");
  return m[1];
}

async function verifyLogin(c) {
  const res = await fetch(`${BASE}/news`, { headers: { cookie: c.cookie, "user-agent": "slash-hn/0.1" } });
  const html = await res.text();
  const user = /href="user\?id=([^"]+)"/.exec(html)?.[1] || "";
  if (!user) throw new Error("HN cookie check failed: could not read logged-in user");
  c.username ||= user;
  return c.username;
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
      await auth(c);
      const user = await verifyLogin(c);
      return done(parsed, { success: true, message: `logged in as ${user}`, user, auth: c.auth || "password", source: c.source || "password" });
    }
    if (cmd === "comment" || cmd === "reply") {
      const id = itemId(parsed._[1] || "");
      const text = await readBody(parsed, 2);
      if (!text) throw new Error("empty comment (pass <text> or --file)");
      await auth(c);
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
