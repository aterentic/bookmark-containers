"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function flatten(nodes, found = []) {
  for (const node of nodes) {
    found.push(node);
    if (node.children) flatten(node.children, found);
  }
  return found;
}

// Records what the extension asks the browser to do, and hands back the
// listeners it registered so tests can drive them directly. Bookmark writes do
// not fire onChanged: tests invoke that listener themselves, so no timer is
// left pending when a test ends.
// Values crossing back from the vm carry its prototypes, which no assertion
// against a plain literal can match.
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function createBrowser({ identities = [], tree = [], tabs = {}, createFails = false } = {}) {
  const calls = {
    menusCreated: [],
    menusUpdated: [],
    bookmarkUpdates: [],
    tabsCreated: [],
    tabsRemoved: [],
    watched: [],
  };
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  let requestListener = null;

  const browser = {
    contextualIdentities: {
      query: async () => {
        if (identities === null) throw new Error("contextualIdentities is not enabled");
        return identities;
      },
      onCreated: event("identityCreated"),
      onUpdated: event("identityUpdated"),
      onRemoved: event("identityRemoved"),
    },
    menus: {
      removeAll: async () => calls.menusCreated.splice(0),
      create: (props) => calls.menusCreated.push(copy(props)),
      update: (id, props) => calls.menusUpdated.push(copy({ id, ...props })),
      refresh: () => {},
      onShown: event("menuShown"),
      onClicked: event("menuClicked"),
    },
    bookmarks: {
      get: async (id) => {
        const node = flatten(tree).find((candidate) => candidate.id === id);
        if (!node) throw new Error(`no bookmark ${id}`);
        return [node];
      },
      getTree: async () => tree,
      update: async (id, changes) => {
        calls.bookmarkUpdates.push(copy({ id, ...changes }));
        Object.assign(flatten(tree).find((candidate) => candidate.id === id), changes);
      },
      onCreated: event("bookmarkCreated"),
      onChanged: event("bookmarkChanged"),
      onRemoved: event("bookmarkRemoved"),
    },
    tabs: {
      get: async (id) => {
        if (!tabs[id]) throw new Error(`no tab ${id}`);
        return tabs[id];
      },
      create: async (props) => {
        if (createFails) throw new Error("no such container");
        calls.tabsCreated.push(copy(props));
        return { id: 999 };
      },
      remove: async (id) => calls.tabsRemoved.push(id),
    },
    webRequest: {
      onBeforeRequest: {
        addListener: (fn, filter) => {
          requestListener = fn;
          calls.watched.push(copy(filter.urls));
        },
        removeListener: () => (requestListener = null),
        hasListener: () => requestListener !== null,
      },
    },
  };

  return { browser, calls, listeners, request: async (details) => copy(await requestListener(details)) };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

// The extension's classic scripts share one global scope, and background.js
// starts working the moment it is evaluated.
async function loadExtension(options) {
  const fake = createBrowser(options);
  const context = vm.createContext({
    URL,
    setTimeout,
    clearTimeout,
    console: { warn() {}, log() {} },
    browser: fake.browser,
  });

  for (const file of ["marker.js", "background.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8"), context);
  }
  await settle();
  return fake;
}

module.exports = { loadExtension, settle };
