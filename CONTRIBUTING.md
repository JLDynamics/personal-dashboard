# Contributing

Thanks for helping improve Local Daily Dashboard.

## Development

1. Install Node.js 22.13 or newer.
2. Run `npm ci`.
3. Copy `.env.example` to `.env.local` if you want local personalization.
4. Run `npm run dev`.

Before opening a pull request, run:

```bash
npm run lint
npm test
```

Keep changes focused, preserve the local-first privacy model, and include tests
for parsing, filtering, ranking, or fallback behavior. Never commit credentials,
browser profiles, calendar exports, generated local caches, or personal event
data.

## Source changes

Public websites can change their markup without notice. When updating a parser:

- keep requests limited to public pages and official feeds or APIs;
- preserve source attribution and original links;
- add a fixture or focused parser test; and
- keep a safe fallback so one failed source does not empty the dashboard.

By contributing, you agree that your contribution is licensed under the MIT
License.
