import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTICLE_CONTENT_MAX_CHARS,
  extractReadableArticleText,
  publicArticleUrl,
} from "../app/data/article-content.ts";

test("extracts readable article body and removes navigation noise", () => {
  const html = `<html><body>
    <header>Subscribe and sign in</header>
    <main>
      <article>
        <h1>A new AI system ships</h1>
        <p>The first paragraph explains what the researchers built and why it matters to practitioners.</p>
        <p>The second paragraph describes the evaluation, limitations, and evidence presented in the release.</p>
        <p>The third paragraph explains availability, licensing, and the next planned development milestone.</p>
        <script>window.secret = "ignore";</script>
      </article>
    </main>
    <footer>All rights reserved</footer>
  </body></html>`;
  const text = extractReadableArticleText(html);
  assert.match(text, /researchers built/);
  assert.match(text, /evaluation, limitations/);
  assert.doesNotMatch(text, /window\.secret|Subscribe|All rights/);
});

test("caps extracted content and rejects private destinations", () => {
  const longBody = `<article>${Array.from(
    { length: 80 },
    (_, index) =>
      `<p>Section ${index}: ${"substantive article text ".repeat(20)}</p>`,
  ).join("")}</article>`;
  assert.equal(
    extractReadableArticleText(longBody).length,
    ARTICLE_CONTENT_MAX_CHARS,
  );
  assert.equal(publicArticleUrl("http://127.0.0.1/private"), undefined);
  assert.equal(publicArticleUrl("http://192.168.1.2/private"), undefined);
  assert.equal(
    publicArticleUrl("https://example.com/article#section"),
    "https://example.com/article",
  );
});
