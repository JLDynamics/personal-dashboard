# Security

## Supported version

Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature instead of opening
a public issue. Include the affected component, reproduction steps, and the
impact you observed. Do not include real credentials, calendar contents, or
other personal data.

## Local security model

- The helper server binds to `127.0.0.1` only.
- Each launch generates a fresh bearer token shared only with the local app
  process.
- Grok credentials remain inside the installed Grok CLI and are never sent to
  browser code.
- Calendar access is read-only at the application level. Event notes,
  attendees, meeting links, and editing are not used.
- Local note access is read-only and limited to regular Markdown files beneath
  the canonical `DASHBOARD_NOTES_FOLDER` root. Hidden directories such as
  `.raw`, hidden files, symlinks, outside paths, non-Markdown files, and
  oversized or unreadable files are skipped. Note paths and the helper bearer
  token are not returned to the browser.
- Successful weekly library cards include full note text in the dashboard's
  browser-local cache so the last good view can survive a temporary outage.
- `.env*`, local build state, compiled helpers, logs, and browser caches are
  excluded from version control.

This project is designed for local use. Do not expose its development server or
helper port directly to the public internet.

## Optional remote MCP doorway

The Claude connector uses a separate loopback-only listener and exposes only
the read-only `ask_dashboard` tool. It reads the existing SQLite snapshot and
cannot request a refresh, browse the web, invoke the local notes reader, open
arbitrary files, or write data.

The remote listener remains disabled unless all OAuth settings are present. It
requires:

- an HTTPS public MCP URL;
- an HTTPS OAuth/OIDC issuer and JWKS URL;
- the exact access-token audience;
- one allowed subject or email;
- the `dashboard-read` scope when the identity provider can issue it; and
- an HTTPS tunnel to the loopback listener.

The public endpoint advertises OAuth protected-resource metadata and validates
the token signature, issuer, audience, expiration, and identity. When a custom
scope is configured, it validates that too. Leaving the scope empty is only
appropriate for this single-user, exact-audience, read-only tool surface. A
tunnel provides HTTPS reachability but is not authorization. Stop the tunnel or
unload the remote launch agent to disable remote access immediately.
