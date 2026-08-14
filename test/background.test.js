"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadExtension, settle } = require("./browser-fake.js");

const WORK = { name: "Work", cookieStoreId: "firefox-container-1", colorCode: "#37adff" };
const PERSONAL = { name: "Personal", cookieStoreId: "firefox-container-2", colorCode: "#51cd00" };
const IDENTITIES = [WORK, PERSONAL];

const bookmark = (id, title, url) => ({ id, type: "bookmark", title, url });

const TREE = [
  {
    id: "root",
    type: "folder",
    title: "Bookmarks",
    children: [
      bookmark("1", "Gmail [Work]", "https://mail.example.com/"),
      bookmark("2", "News", "https://news.example.com/"),
      bookmark("3", "Release [1234]", "https://ci.example.com/"),
    ],
  },
];

const tree = () => JSON.parse(JSON.stringify(TREE));

const inTab = (overrides) => ({
  id: 1,
  index: 3,
  active: true,
  windowId: 5,
  cookieStoreId: "firefox-default",
  url: "about:newtab",
  incognito: false,
  ...overrides,
});

test("the submenu offers no container plus every container", async () => {
  const { calls } = await loadExtension({ identities: IDENTITIES, tree: tree() });
  assert.deepEqual(
    calls.menusCreated.map((item) => item.title),
    ["Set container", "No container (default)", "Work", "Personal"]
  );
  assert.equal(calls.menusCreated[0].contexts[0], "bookmark");
  assert.ok(calls.menusCreated[2].icons[16].startsWith("data:image/svg+xml"));
});

test("with containers disabled the submenu says so", async () => {
  const { calls } = await loadExtension({ identities: null, tree: tree() });
  assert.deepEqual(
    calls.menusCreated.map((item) => item.title),
    ["Set container", "No container (default)", "No containers available"]
  );
});

test("opening the menu checks the container the bookmark carries", async () => {
  const { listeners, calls } = await loadExtension({ identities: IDENTITIES, tree: tree() });
  await listeners.menuShown({ contexts: ["bookmark"], bookmarkId: "1" });

  assert.deepEqual(calls.menusUpdated, [
    { id: "set-container", visible: true },
    { id: "container:none", checked: false },
    { id: "container:firefox-container-1", checked: true },
    { id: "container:firefox-container-2", checked: false },
  ]);
});

test("a bookmark with no marker checks no container", async () => {
  const { listeners, calls } = await loadExtension({ identities: IDENTITIES, tree: tree() });
  await listeners.menuShown({ contexts: ["bookmark"], bookmarkId: "2" });

  assert.deepEqual(calls.menusUpdated[1], { id: "container:none", checked: true });
});

test("the submenu is hidden for anything that cannot carry a container", async () => {
  const { listeners, calls } = await loadExtension({ identities: IDENTITIES, tree: tree() });
  await listeners.menuShown({ contexts: ["bookmark"], bookmarkId: "root" });

  assert.deepEqual(calls.menusUpdated, [{ id: "set-container", visible: false }]);
});

test("choosing a container writes the marker into the title", async () => {
  const { listeners, calls } = await loadExtension({ identities: IDENTITIES, tree: tree() });
  await listeners.menuClicked({ menuItemId: "container:firefox-container-2", bookmarkId: "2" });

  assert.deepEqual(calls.bookmarkUpdates, [{ id: "2", title: "News [Personal]" }]);
});

test("choosing no container strips the marker", async () => {
  const { listeners, calls } = await loadExtension({ identities: IDENTITIES, tree: tree() });
  await listeners.menuClicked({ menuItemId: "container:none", bookmarkId: "1" });

  assert.deepEqual(calls.bookmarkUpdates, [{ id: "1", title: "Gmail" }]);
});

test("brackets that name no container are not mistaken for a marker", async () => {
  const { listeners, calls } = await loadExtension({ identities: IDENTITIES, tree: tree() });
  await listeners.menuClicked({ menuItemId: "container:firefox-container-1", bookmarkId: "3" });

  assert.deepEqual(calls.bookmarkUpdates, [{ id: "3", title: "Release [1234] [Work]" }]);
});

test("choosing the container a bookmark already has writes nothing", async () => {
  const { listeners, calls } = await loadExtension({ identities: IDENTITIES, tree: tree() });
  await listeners.menuClicked({ menuItemId: "container:firefox-container-1", bookmarkId: "1" });

  assert.deepEqual(calls.bookmarkUpdates, []);
});

test("only the marked hosts are watched", async () => {
  const { calls } = await loadExtension({ identities: IDENTITIES, tree: tree() });
  assert.deepEqual(calls.watched, [["https://mail.example.com/*"]]);
});

test("nothing marked means no listener at all", async () => {
  const { calls } = await loadExtension({
    identities: IDENTITIES,
    tree: [{ id: "root", type: "folder", children: [bookmark("1", "News", "https://news.example.com/")] }],
  });
  assert.deepEqual(calls.watched, []);
});

test("a marked URL in the wrong container is cancelled and reopened", async () => {
  const { request, calls } = await loadExtension({
    identities: IDENTITIES,
    tree: tree(),
    tabs: { 1: inTab() },
  });

  const result = await request({ url: "https://mail.example.com/", tabId: 1 });

  assert.deepEqual(result, { cancel: true });
  assert.deepEqual(calls.tabsCreated, [
    {
      url: "https://mail.example.com/",
      cookieStoreId: "firefox-container-1",
      index: 3,
      active: true,
      windowId: 5,
    },
  ]);
  assert.deepEqual(calls.tabsRemoved, [1]);
});

test("a tab already showing a page keeps it, and the container tab opens beside it", async () => {
  const { request, calls } = await loadExtension({
    identities: IDENTITIES,
    tree: tree(),
    tabs: { 1: inTab({ url: "https://news.example.com/" }) },
  });

  await request({ url: "https://mail.example.com/", tabId: 1 });

  assert.equal(calls.tabsCreated[0].index, 4);
  assert.deepEqual(calls.tabsRemoved, []);
});

test("a tab already in the right container is left alone", async () => {
  const { request, calls } = await loadExtension({
    identities: IDENTITIES,
    tree: tree(),
    tabs: { 1: inTab({ cookieStoreId: "firefox-container-1" }) },
  });

  assert.deepEqual(await request({ url: "https://mail.example.com/", tabId: 1 }), {});
  assert.deepEqual(calls.tabsCreated, []);
});

test("private windows are left alone", async () => {
  const { request, calls } = await loadExtension({
    identities: IDENTITIES,
    tree: tree(),
    tabs: { 1: inTab({ incognito: true }) },
  });

  assert.deepEqual(await request({ url: "https://mail.example.com/", tabId: 1 }), {});
  assert.deepEqual(calls.tabsCreated, []);
});

test("an unmarked URL on a watched host passes through", async () => {
  const { request, calls } = await loadExtension({
    identities: IDENTITIES,
    tree: tree(),
    tabs: { 1: inTab() },
  });

  assert.deepEqual(await request({ url: "https://mail.example.com/other", tabId: 1 }), {});
  assert.deepEqual(calls.tabsCreated, []);
});

test("a request with no tab passes through", async () => {
  const { request } = await loadExtension({ identities: IDENTITIES, tree: tree(), tabs: {} });
  assert.deepEqual(await request({ url: "https://mail.example.com/", tabId: -1 }), {});
});

test("a container that cannot be opened fails open rather than blocking", async () => {
  const { request, calls } = await loadExtension({
    identities: IDENTITIES,
    tree: tree(),
    tabs: { 1: inTab() },
    createFails: true,
  });

  assert.deepEqual(await request({ url: "https://mail.example.com/", tabId: 1 }), {});
  assert.deepEqual(calls.tabsRemoved, []);
});

test("editing a bookmark re-indexes what is watched", async () => {
  const fake = await loadExtension({ identities: IDENTITIES, tree: tree() });

  await fake.listeners.menuClicked({ menuItemId: "container:firefox-container-2", bookmarkId: "2" });
  fake.listeners.bookmarkChanged("2", { title: "News [Personal]" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await settle();

  assert.deepEqual(fake.calls.watched.at(-1), [
    "https://mail.example.com/*",
    "https://news.example.com/*",
  ]);
});
