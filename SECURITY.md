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
- Agent-note access uses its existing `recent` command and guarded note reads.
  Raw conversation sources, paths outside the configured notes folder, and
  non-Markdown files remain blocked by Agent-note. Note paths and the helper
  bearer token are not returned to the browser.
- Successful weekly library cards include full note text in the dashboard's
  browser-local cache so the last good view can survive a temporary outage.
- `.env*`, local build state, compiled helpers, logs, and browser caches are
  excluded from version control.

This project is designed for local use. Do not expose its development server or
helper port directly to the public internet.
