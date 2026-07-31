import assert from "node:assert/strict";
import test from "node:test";

import {
  collectRecentYfspMovies,
  parseRecentYfspHtml,
  parseYfspSynopsis,
  shortenSynopsis,
} from "../scripts/yfsp-recent.mjs";

function card({ id, title, poster, genre, rating = "" }) {
  return `<div class="v-c new">
    <a title="${title}" href="/play/${id}">
      <img class="poster d-block" src="${poster}" alt="${title}">
      ${rating ? `<div class="rating">${rating}</div>` : ""}
    </a>
    <div class="tag-text text-light"><span>${genre}</span></div>
  </div>`;
}

test("extracts the first three YFSP Recently Added cards in page order", () => {
  const html = `<div id="list-page">
    ${card({ id: "one", title: "First", poster: "https://static.yfsp.tv/one.jpg?w=238&amp;h=340", genre: "动作 科幻", rating: "7.3" })}
    ${card({ id: "two", title: "Second", poster: "https://static.yfsp.tv/two.jpg", genre: "剧情 犯罪" })}
    ${card({ id: "three", title: "Third", poster: "https://static.yfsp.tv/three.jpg", genre: "爱情 奇幻", rating: "5.5" })}
    ${card({ id: "four", title: "Fourth", poster: "https://static.yfsp.tv/four.jpg", genre: "喜剧" })}
  </div>`;

  const result = parseRecentYfspHtml(
    html,
    new Date("2026-07-28T18:00:00.000Z"),
  );

  assert.deepEqual(
    result.items.map((movie) => movie.title),
    ["First", "Second", "Third"],
  );
  assert.equal(
    result.items[0].posterUrl,
    "https://static.yfsp.tv/one.jpg?w=238&h=340",
  );
  assert.equal(result.items[0].releaseLabel, "Recently added");
  assert.equal(result.items[1].rating, undefined);
});

test("rejects missing, malformed, or non-YFSP poster cards", () => {
  assert.throws(
    () =>
      parseRecentYfspHtml(
        `<div id="list-page">${card({
          id: "one",
          title: "First",
          poster: "https://example.com/poster.jpg",
          genre: "Drama",
        })}</div>`,
      ),
    (error) =>
      error?.stage === "validation" &&
      error?.code === "three_cards_required",
  );
});

test("extracts and locally shortens a real detail-page synopsis", () => {
  const html = `<div class="summary show">
    A first sentence explains the setup. A second sentence raises the central conflict.
    A third sentence gives away the ending.
  </div>`;
  assert.equal(
    parseYfspSynopsis(html, "Example"),
    "A first sentence explains the setup. A second sentence raises the central conflict.",
  );
  assert.equal(shortenSynopsis("短句。第二句。第三句。"), "短句。第二句。");
});

test("collects the list first, then adds three detail-page summaries", async () => {
  const listHtml = `<div id="list-page">
    ${card({ id: "one", title: "First", poster: "https://static.yfsp.tv/one.jpg", genre: "动作 科幻" })}
    ${card({ id: "two", title: "Second", poster: "https://static.yfsp.tv/two.jpg", genre: "剧情 犯罪" })}
    ${card({ id: "three", title: "Third", poster: "https://static.yfsp.tv/three.jpg", genre: "爱情 奇幻" })}
  </div>`;
  const summaries = new Map([
    ["one", "First setup sentence. First conflict sentence."],
    ["two", "Second setup sentence. Second conflict sentence."],
    ["three", "Third setup sentence. Third conflict sentence."],
  ]);
  const calls = [];
  const result = await collectRecentYfspMovies({
    collectedAt: new Date("2026-07-28T18:00:00.000Z"),
    render: async (_executable, args) => {
      const url = args.at(-1);
      calls.push(url);
      if (url.includes("/list/movie")) return listHtml;
      const id = url.split("/").at(-1);
      return `<div class="summary show">${summaries.get(id)}</div>`;
    },
  });

  assert.equal(calls.length, 4);
  assert.deepEqual(
    result.items.map((movie) => movie.description),
    [...summaries.values()],
  );
  assert.ok(
    calls.slice(1).every((url) => /^https:\/\/www\.yfsp\.tv\/play\//.test(url)),
  );
});
