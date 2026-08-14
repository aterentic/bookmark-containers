"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// The extension ships classic scripts sharing one global scope; recreate that
// here so the pure helpers can be exercised without a browser.
const context = vm.createContext({ URL, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "marker.js"), "utf8"), context);
const {
  parseTitle,
  containerMarker,
  withMarker,
  withoutMarker,
  normalizeUrl,
  markedBookmarks,
  containersByName,
  buildIndex,
  containerFor,
  markedHostPatterns,
} = vm.runInContext(
  "({parseTitle, containerMarker, withMarker, withoutMarker, normalizeUrl, markedBookmarks, containersByName, buildIndex, containerFor, markedHostPatterns})",
  context
);

const plain = (value) => JSON.parse(JSON.stringify(value));

const WORK = { name: "Work", cookieStoreId: "firefox-container-1", colorCode: "#37adff" };
const PERSONAL = { name: "Personal", cookieStoreId: "firefox-container-2", colorCode: "#51cd00" };
const CONTAINERS = containersByName([WORK, PERSONAL]);

test("a trailing marker separates the name from the container", () => {
  assert.deepEqual(plain(parseTitle("Gmail [Work]")), { base: "Gmail", name: "Work" });
  assert.deepEqual(plain(parseTitle("Gmail")), { base: "Gmail", name: null });
});

test("container names may contain spaces and punctuation", () => {
  const containers = containersByName([{ name: "Work & Co", cookieStoreId: "firefox-container-9" }]);
  assert.equal(containerMarker("Gmail [Work & Co]", containers).name, "Work & Co");
});

test("only the trailing bracket group can be a marker", () => {
  assert.equal(containerMarker("[Work] Notes", CONTAINERS), null);
  assert.equal(containerMarker("Bug [1234] report [Work]", CONTAINERS).base, "Bug [1234] report");
});

test("brackets that name no container are the user's own text", () => {
  assert.equal(containerMarker("Release [1234]", CONTAINERS), null);
  assert.equal(withoutMarker("Release [1234]", CONTAINERS), "Release [1234]");
  assert.equal(withMarker("Release [1234]", "Work", CONTAINERS), "Release [1234] [Work]");
});

test("setting a container replaces a marker already there", () => {
  assert.equal(withMarker("Gmail", "Work", CONTAINERS), "Gmail [Work]");
  assert.equal(withMarker("Gmail [Work]", "Personal", CONTAINERS), "Gmail [Personal]");
  assert.equal(withMarker("", "Work", CONTAINERS), "[Work]");
});

test("clearing a container restores the plain name", () => {
  assert.equal(withoutMarker("Gmail [Work]", CONTAINERS), "Gmail");
  assert.equal(withoutMarker("Gmail", CONTAINERS), "Gmail");
});

test("markers match container names case-insensitively", () => {
  assert.equal(containerMarker("Docs [work]", CONTAINERS).name, "work");
  assert.equal(withoutMarker("Docs [work]", CONTAINERS), "Docs");
});

test("normalizeUrl drops the fragment and rejects what cannot be intercepted", () => {
  assert.equal(normalizeUrl("https://Example.COM#section"), "https://example.com/");
  assert.equal(normalizeUrl("place:parent=toolbar"), null);
  assert.equal(normalizeUrl("javascript:void(0)"), null);
});

const TREE = [
  {
    id: "root",
    children: [
      { id: "1", title: "Gmail [Work]", url: "https://mail.example.com/" },
      { id: "2", title: "Gmail [Personal]", url: "https://mail.example.com/u/1/" },
      { id: "3", title: "News", url: "https://news.example.com/" },
      { id: "4", title: "Old [Retired]", url: "https://retired.example.com/" },
      { id: "5", title: "Folder", children: [{ id: "6", title: "Docs [work]", url: "https://docs.example.com/" }] },
      { id: "7", title: "Jenkins [Work]", url: "http://ci.example.org:8080/" },
    ],
  },
];

test("marked bookmarks are found at any depth", () => {
  assert.deepEqual(
    plain(markedBookmarks(TREE, CONTAINERS).map((entry) => entry.id)),
    ["1", "2", "6", "7"]
  );
});

test("the index maps marked URLs to their container", () => {
  const index = buildIndex(TREE, CONTAINERS);
  assert.equal(containerFor(index, "https://mail.example.com/"), WORK.cookieStoreId);
  assert.equal(containerFor(index, "https://mail.example.com/u/1/"), PERSONAL.cookieStoreId);
  assert.equal(containerFor(index, "https://docs.example.com/"), WORK.cookieStoreId);
});

test("a marker naming no container binds nothing", () => {
  const index = buildIndex(TREE, CONTAINERS);
  assert.equal(containerFor(index, "https://retired.example.com/"), null);
  assert.equal(containerFor(index, "https://news.example.com/"), null);
});

test("host patterns carry no port, which match patterns forbid", () => {
  assert.deepEqual(plain(markedHostPatterns(buildIndex(TREE, CONTAINERS))), [
    "https://mail.example.com/*",
    "https://docs.example.com/*",
    "http://ci.example.org/*",
  ]);
});

test("nothing marked means nothing watched", () => {
  assert.deepEqual(plain(markedHostPatterns(buildIndex([], CONTAINERS))), []);
});
