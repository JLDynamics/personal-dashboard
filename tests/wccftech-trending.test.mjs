import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalWccftechUrl,
  parseWccftechTrendingStories,
} from "../app/data/wccftech-trending.ts";

const html = `
  <h3>Trending Stories</h3>
  <ul>
    <li>
      <h4><a href="https://wccftech.com/first/?utm_source=test">First &amp; best</a></h4>
      <div><span>1,204</span><span>Active Readers</span></div>
    </li>
    <li>
      <h4><a href="https://wccftech.com/second/">Second story</a></h4>
      <div><span>83</span><span>Active Readers</span></div>
    </li>
    <li>
      <h4><a href="https://example.com/not-wccftech">Wrong host</a></h4>
      <div><span>50</span><span>Active Readers</span></div>
    </li>
    <li>
      <h4><a href="https://www.wccftech.com/third/#comments">Third story</a></h4>
      <div><span>42</span><span>Active Readers</span></div>
    </li>
  </ul>
`;

test("parses the first three valid public Wccftech trending stories", () => {
  assert.deepEqual(parseWccftechTrendingStories(html), [
    {
      rank: 1,
      title: "First & best",
      url: "https://wccftech.com/first",
      activeReaders: 1204,
    },
    {
      rank: 2,
      title: "Second story",
      url: "https://wccftech.com/second",
      activeReaders: 83,
    },
    {
      rank: 3,
      title: "Third story",
      url: "https://wccftech.com/third",
      activeReaders: 42,
    },
  ]);
});

test("canonicalizes only public HTTPS Wccftech article URLs", () => {
  assert.equal(
    canonicalWccftechUrl("https://www.wccftech.com/story/?ref=home#top"),
    "https://wccftech.com/story",
  );
  assert.equal(canonicalWccftechUrl("http://wccftech.com/story"), undefined);
  assert.equal(canonicalWccftechUrl("https://example.com/story"), undefined);
});
