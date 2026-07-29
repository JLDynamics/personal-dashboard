# Local Daily Dashboard

A polished, local-first daily briefing for AI, technology, weather, markets,
calendar events, your recent Agent-note library, and newly added movies. The
dashboard shows saved data immediately from a small local SQLite cache. It
refreshes news every three hours, refreshes Agent-note twice a day, and still
supports a complete manual refresh with **Refresh now**.

The application is intentionally personal and local:

- one bounded local SQLite database stores the latest snapshot and source state;
- browser preferences and cached cards stay in `localStorage`;
- local helpers bind only to `127.0.0.1`;
- scheduled refreshes run only while the local dashboard process is running;
- a read-only local MCP tool can answer questions from cached data; and
- one failed source never removes the last good cards from another source.

## What it includes

| Card | Source and selection |
| --- | --- |
| Trending AI | Three current X stories collected through an authenticated local Grok CLI, plus three AI stories selected from Hacker News `topstories` |
| Tech News | Five stories from The Verge's public Most Popular list, three Wccftech Trending stories, and three recent stories each from MobileSyrup and iPhone in Canada |
| My Library · Past 7 Days | Recent normal notes from Agent-note, with title, saved time, tags, the note's saved brief summary, and the guarded full Markdown note |
| Weather | Open-Meteo using configurable coordinates, label, and time zone |
| Tesla | Yahoo Finance's keyless TSLA five-day chart endpoint |
| Schedule | Up to eight upcoming macOS Calendar events from the next seven days |
| New Movies | The first three public entries in YFSP's Recently Added list |

The Hacker News selector preserves official HN rank, scans candidates in
batches of five, and stops when three AI stories qualify or the first 30 ranked
stories have been checked. Tech News uses publisher rankings where available
and a deterministic diversity-first selector for the two RSS-only sources.
Opening an RSS-selected story gives its topic a small, browser-local preference
boost on later refreshes.

## Requirements

- Node.js 22.13 or newer
- npm
- macOS for the optional Schedule card
- Google Chrome for live YFSP movie extraction
- An installed and authenticated Grok CLI for live X collection and Grok
  summaries
- Agent-note in the sibling `../Agent-note` folder, or an explicit
  `AGENT_NOTE_PROJECT_DIR`, for the optional My Library card

The dashboard still starts when optional local capabilities are unavailable.
It keeps the last successful SQLite snapshot, browser cards, or bundled sample
data for those sections.

## Quick start

```bash
git clone https://github.com/JLDynamics/personal-dashboard.git
cd personal-dashboard
npm ci
cp .env.example .env.local
npm run dev
```

Open the local URL printed in the terminal.

Edit `.env.local` to personalize the greeting and weather:

```dotenv
DASHBOARD_DISPLAY_NAME=Your name
DASHBOARD_WEATHER_LATITUDE=0
DASHBOARD_WEATHER_LONGITUDE=0
DASHBOARD_WEATHER_LOCATION=Sample location
DASHBOARD_TIME_ZONE=UTC
```

Keep your real location values only in the ignored `.env.local` file. If the
Grok executable is not on your `PATH`, add its absolute path:

```dotenv
GROK_CLI_PATH=/absolute/path/to/grok
```

If Agent-note is stored elsewhere, add its project path:

```dotenv
AGENT_NOTE_PROJECT_DIR=/absolute/path/to/Agent-note
```

Local environment files are ignored by Git.

## How refresh works

1. The browser renders bundled sample data or its last locally saved view.
2. The local cache daemon opens the latest snapshot from
   `.local/dashboard.sqlite3`.
3. News sources are due every three hours; Agent-note is due every 12 hours.
4. Each source has its own SHA-256 content fingerprint. Unchanged sources keep
   their existing cards, while changed sources replace only their own rows.
5. Local validation rejects malformed, duplicated, stale, or unsafe results.
6. A manual refresh repeats the complete flow through
   `/api/dashboard?force=1`.

The server coalesces simultaneous refreshes and keeps a 60-second in-process
cache. The HTTP response itself is marked `no-store`. SQLite contains one
current dashboard snapshot plus one state row per source, so refreshes overwrite
bounded data instead of accumulating article history.

Hacker News first checks the deterministic official `topstories` selection. If
the selected story IDs are unchanged, the previous summaries are reused and no
new Grok summary call runs. The X refresh still requires its bounded Grok search
because X does not provide an equivalent public source fingerprint.

## Ask My Dashboard

Starting the app also starts a local MCP server at
`loopback-only MCP endpoint`. It currently exposes one read-only tool:
`ask_dashboard`.

The tool selects only the relevant parts of the cached dashboard, then asks the
local Grok 4.5 CLI for a concise answer. Web search and local file tools are
disabled for this operation, so it cannot silently fetch new information or
modify the dashboard. The result includes the cache timestamp and the dashboard
sections it used.

Port 8791 remains intentionally localhost-only. An optional second listener can
serve the same one-tool MCP surface on port 8792 for a Claude custom connector.
The remote listener refuses to start unless its HTTPS public URL, OAuth issuer,
JWKS URL, token audience, and one approved identity are configured. A separate
`dashboard-read` scope is preferred when the identity provider issues custom
scopes. For a single-user provider that does not, the scope may be left empty
because the exact audience, exact identity, and read-only tool surface remain
mandatory. It still binds only to loopback and must sit behind a secure HTTPS
tunnel.

The remote doorway uses MCP 2026-07-28 while retaining the SDK's compatible
legacy transport for current Claude clients. It publishes RFC 9728 protected
resource metadata, validates signed Auth0 JWT access tokens, and rejects any
other identity or audience. When configured, it also requires the custom scope.
Claude receives only `ask_dashboard`; it cannot refresh sources, open files, or
modify dashboard or Agent-note data.

Validate the remote environment without opening a port:

```bash
npm run mcp:check-remote
```

Never expose the local development server, port 8788, port 8790, or the
unauthenticated local MCP port 8791 through a tunnel.

## Model usage

The dashboard does not use a model to rank ordinary RSS, weather, market, or
calendar data.

My Library does not invoke a model. Its card uses the durable brief summary
already saved by the agent that created the normal Agent-note note.

The local helper uses Grok for four bounded operations:

1. search public X discussion for three current AI news clusters;
2. summarize the readable bodies of the three already-selected Hacker News
   articles, with web search disabled; and
3. translate the three selected movie titles, genres, and synopses into English,
   with web search disabled; and
4. answer an explicit `ask_dashboard` question from selected cached sections,
   with both web search and local tools disabled.

All model output is parsed and validated locally. Credentials stay inside the
installed Grok CLI and never enter browser code.

## Calendar privacy

The macOS helper requests Calendar permission once and reads only:

- event title;
- start and end time;
- all-day state;
- calendar name; and
- the first location line.

It does not return notes, attendees, meeting links, or editing capabilities.
Birthdays, subscribed holiday calendars, Siri suggestions, and scheduled
reminders are excluded. If permission is denied, the Schedule card keeps its
last successful view.

## Agent-note privacy

The local helper invokes Agent-note's existing JSON CLI for `recent --days 7`
and its guarded `read --path` operation. Agent-note remains responsible for its
configured notes folder, excluding raw conversation sources, and refusing
outside or non-Markdown paths. Note paths and the helper bearer token are not
sent to browser code.

The browser stores the successful weekly library cards, including their full
Markdown note text, in the dashboard's local cache so an existing view survives
a temporary Agent-note outage. That cache stays in the current browser profile
on this computer and is replaced when Agent-note next returns a successful
result.

## Movie-source boundary

The movie helper reads only public listing and detail-page metadata. It does not
use an account, browser profile, or playback link, and the dashboard never
renders source or playback links. “Recently added” describes the source site's
ordering, not a claim about the movie's original release date.

## Project structure

```text
app/
  api/dashboard/route.ts    refresh cache and HTTP boundary
  dashboard.tsx             dashboard UI
  data/                     source adapters, filtering, merging, and types
scripts/
  run-local.mjs             starts all local services and the app together
  grok-x-collector.mjs      token-protected loopback helper
  dashboard-cache.mjs       bounded SQLite snapshot and source fingerprints
  dashboard-daemon.ts       scheduled refresh coordinator
  dashboard-answer.mjs      cached-data-only Grok question answering
  dashboard-mcp.ts          local and authenticated remote MCP listeners
  dashboard-remote-auth.ts  OAuth/JWT validation and resource metadata
  calendar-events.m         minimal macOS EventKit reader
  agent-note-library.mjs    Agent-note CLI adapter for weekly notes
  yfsp-recent.mjs           public movie-list extraction
tests/                      parser, selector, security, and SSR tests
worker/index.ts             vinext worker entry point
```

## Development

```bash
npm run dev
npm run lint
npm run typecheck
npm test
```

`npm test` performs a production build before running the Node test suite.
`npm run daemon` and `npm run mcp` are available for focused local debugging;
normal use should start everything together with `npm run dev`.

## Build tooling

The project uses vinext, Vite, and Cloudflare's Vite plugin as local build
tools. They compile the Next-style `app/` routes and provide the Worker-like
environment used by the local API route. Running or building the dashboard does
not require a Cloudflare account and does not deploy or upload the application.

## Security

Do not expose the development server or helper port directly to the internet.
See [SECURITY.md](SECURITY.md) for the local threat model and private reporting
instructions.

Source names, article text, movie metadata, and trademarks belong to their
respective owners. This project is not affiliated with X, xAI, Hacker News,
The Verge, Wccftech, MobileSyrup, iPhone in Canada, Yahoo, Open-Meteo, or YFSP.
Users are responsible for following each source's terms and applicable law.

## Contributing

Focused fixes and source-adapter improvements are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

The project code is available under the [MIT License](LICENSE).
