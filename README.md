# Local Daily Dashboard

A polished, local-first daily briefing for AI, technology, weather, markets,
calendar events, your recent local Markdown notes, and newly added movies. The
dashboard shows saved data immediately from a small local SQLite cache. It
refreshes every live source every three hours, refreshes the notes library twice
a day, and still supports a complete manual refresh with **Refresh now**.

The application is intentionally personal and local:

- one bounded local SQLite database stores the latest snapshot and source state;
- browser preferences and cached cards stay in `localStorage`;
- local helpers accept connections only from the same computer;
- scheduled refreshes run only while the local dashboard process is running;
- a read-only local MCP tool can answer questions from cached data; and
- one failed source never removes the last good cards from another source.

## What it includes

| Card | Source and selection |
| --- | --- |
| Trending AI | Three current X stories collected through an authenticated local Grok CLI, plus three AI stories selected from Hacker News `topstories` |
| Tech News | Five stories from The Verge's public Most Popular list, three Wccftech Trending stories, and three recent stories each from MobileSyrup and iPhone in Canada |
| My Library · Past 7 Days | Recent normal Markdown notes from the configured local folder, with title, saved time, tags, the note's stored brief summary, and the full note |
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
- An installed and authenticated Grok CLI for live X collection, Hacker News
  summaries, and explicit dashboard questions
- A readable local notes folder for the optional My Library card

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
# Optional. Defaults to America/Edmonton when missing or invalid.
# DASHBOARD_TIME_ZONE=America/Edmonton
```

Keep your real location values only in the ignored `.env.local` file. If the
Grok executable is not on your `PATH`, add its absolute path:

```dotenv
GROK_CLI_PATH=/absolute/path/to/grok
```

My Library reads `~/.notes` by default. To use another folder, add its absolute
path:

```dotenv
DASHBOARD_NOTES_FOLDER=/absolute/path/to/notes
```

The dashboard and Agent-note are separate projects. The dashboard does not read
Agent-note configuration or run its code, CLI, or MCP server. It intentionally
understands the same simple Markdown format (`title`, `date`, `tags`, and
optional `summary` frontmatter), so an existing note folder can remain shared
without copying or starting the Agent-note project.

For migration from the old bridge, remove `AGENT_NOTE_PROJECT_DIR` and
`AGENT_NOTE_CLI_PATH`. If `~/.notesrc` previously selected a custom
`notes_folder`, put that folder's expanded absolute path in
`DASHBOARD_NOTES_FOLDER`; no note migration is needed.

Local environment files are ignored by Git.

## How refresh works

1. The browser renders bundled sample data or its last locally saved view.
2. The local cache daemon opens the latest snapshot from
   `.local/dashboard.sqlite3`.
3. News, weather, market, calendar, and movies are due every three hours; local
   notes are due every 12 hours.
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

The optional loopback-only MCP server exposes one read-only tool:
`ask_dashboard`. Start it only when local MCP testing is needed:

```bash
npm run mcp
```

The tool selects only the relevant parts of the cached dashboard, then asks the
local Grok 4.5 CLI for a concise answer. Web search and local file tools are
disabled for this operation, so it cannot silently fetch new information or
modify the dashboard. The result includes the cache timestamp and the dashboard
sections it used.

The local MCP service remains intentionally reachable only from the same
computer. An optional second loopback-only listener can serve the same one-tool
surface for a Claude custom connector. The remote listener refuses to start
unless its HTTPS public URL, OAuth issuer, JWKS URL, token audience, and one
approved identity are configured. A separate `dashboard-read` scope is
preferred when the identity provider issues custom scopes. For a single-user
provider that does not, the scope may be left empty because the exact audience,
exact identity, and read-only tool surface remain mandatory. It must sit behind
a secure HTTPS tunnel.

The remote doorway uses MCP 2026-07-28 while retaining the SDK's compatible
legacy transport for current Claude clients. It publishes RFC 9728 protected
resource metadata, validates signed Auth0 JWT access tokens, and rejects any
other identity or audience. When configured, it also requires the custom scope.
Claude receives only `ask_dashboard`; it cannot refresh sources, open files, or
modify dashboard or notes data.

Validate the remote environment without opening a port:

```bash
npm run mcp:check-remote
```

Never expose the development server, local helper, cache coordinator, or
unauthenticated local MCP service through a tunnel.

## Model usage

The dashboard does not use a model to rank ordinary RSS, weather, market, or
calendar data.

My Library does not invoke a model. Its card uses the durable brief summary
already stored in the normal note's frontmatter. Older notes without a summary
retain a small deterministic body-text fallback.

The local helper uses Grok for three bounded operations:

1. search public X discussion for three current AI news clusters;
2. summarize the readable bodies of the three already-selected Hacker News
   articles, with web search disabled; and
3. answer an explicit `ask_dashboard` question from selected cached sections,
   with both web search and local tools disabled.

All model output is parsed and validated locally. Credentials stay inside the
installed Grok CLI and never enter browser code.

Movies do not use a model. Their title, genre, and synopsis remain in the
source language returned by YFSP after local three-card validation.

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

## Local notes privacy

The local helper is a narrow read-only folder adapter. It resolves the
configured notes root and every accepted file to canonical paths, reads only
regular Markdown files still inside that root, and skips symlinks, hidden
directories such as `.raw`, hidden files, non-Markdown files, and oversized or
unreadable files. It never exposes note paths to browser code.

This adapter provides no note search, write, import, or MCP tools. It does not
start Agent-note or call a model. Compatibility is limited to reading the
existing plain-Markdown frontmatter format.

The browser stores the successful weekly library cards, including their full
Markdown note text, in the dashboard's local cache so an existing view survives
a temporary notes-folder outage. That cache stays in the current browser
profile on this computer and is replaced when the folder next returns a
successful result.

## Movie-source boundary

The movie helper reads only public listing and detail-page metadata. It does not
use an account, browser profile, or playback link, and the dashboard never
renders source or playback links. “Recently added” describes the source site's
ordering, not a claim about the movie's original release date. Movie text is
shown in the source language without translation.

## Project structure

```text
app/
  api/dashboard/route.ts    refresh cache and HTTP boundary
  dashboard.tsx             dashboard UI
  data/                     source adapters, filtering, merging, and types
scripts/
  run-local.mjs             starts the collector, coordinator, and app together
  grok-x-collector.mjs      token-protected loopback helper
  dashboard-cache.mjs       bounded SQLite snapshot and source fingerprints
  dashboard-daemon.ts       scheduled refresh coordinator
  dashboard-answer.mjs      cached-data-only Grok question answering
  dashboard-mcp.ts          local and authenticated remote MCP listeners
  dashboard-remote-auth.ts  OAuth/JWT validation and resource metadata
  calendar-events.m         minimal macOS EventKit reader
  local-notes-library.mjs   guarded direct reader for weekly Markdown notes
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
`npm run daemon` and `npm run mcp` are available for focused local debugging.
Normal use starts the collector, refresh coordinator, and visual app together
with `npm run dev`; it does not start the optional local MCP listener. The
authenticated remote MCP connector is managed separately and is unaffected.

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
