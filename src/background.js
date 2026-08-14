"use strict";

const ROOT_MENU_ID = "set-container";
const MENU_PREFIX = "container:";
const NO_CONTAINER = "none";
const DISPOSABLE_TAB_URLS = new Set(["about:blank", "about:newtab", "about:home", ""]);
const REINDEX_DELAY_MS = 200;

let identities = [];
let containers = new Map();
let urlIndex = new Map();
let menuItemIds = [];

function menuIdFor(choice) {
  return MENU_PREFIX + choice;
}

function choiceFromMenuId(menuItemId) {
  return typeof menuItemId === "string" && menuItemId.startsWith(MENU_PREFIX)
    ? menuItemId.slice(MENU_PREFIX.length)
    : null;
}

function dotIcon(colorCode) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${colorCode}"/></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// The query throws when privacy.userContext.enabled is off.
async function refreshIdentities() {
  try {
    identities = await browser.contextualIdentities.query({});
  } catch {
    identities = [];
  }
  containers = containersByName(identities);
}

// Menus

async function rebuildMenus() {
  await browser.menus.removeAll();
  menuItemIds = [];

  browser.menus.create({
    id: ROOT_MENU_ID,
    title: "Set container",
    contexts: ["bookmark"],
  });

  const addChoice = (choice, title, icons) => {
    const id = menuIdFor(choice);
    browser.menus.create({
      id,
      parentId: ROOT_MENU_ID,
      type: "radio",
      title,
      contexts: ["bookmark"],
      ...(icons ? { icons } : {}),
    });
    menuItemIds.push(id);
  };

  addChoice(NO_CONTAINER, "No container (default)");

  if (identities.length === 0) {
    browser.menus.create({
      id: "containers-unavailable",
      parentId: ROOT_MENU_ID,
      title: "No containers available",
      enabled: false,
      contexts: ["bookmark"],
    });
    return;
  }

  for (const identity of identities) {
    addChoice(identity.cookieStoreId, identity.name, { 16: dotIcon(identity.colorCode) });
  }
}

async function markableBookmark(bookmarkId) {
  if (!bookmarkId) return null;
  let node;
  try {
    [node] = await browser.bookmarks.get(bookmarkId);
  } catch {
    return null;
  }
  if (node.type !== "bookmark" || normalizeUrl(node.url) === null) return null;
  return node;
}

function currentChoice(node) {
  const marker = containerMarker(node.title, containers);
  return marker === null ? NO_CONTAINER : containers.get(marker.name.toLowerCase()).cookieStoreId;
}

browser.menus.onShown.addListener(async (info) => {
  if (!info.contexts.includes("bookmark")) return;

  const node = await markableBookmark(info.bookmarkId);
  browser.menus.update(ROOT_MENU_ID, { visible: node !== null });

  if (node) {
    const checkedId = menuIdFor(currentChoice(node));
    for (const id of menuItemIds) {
      browser.menus.update(id, { checked: id === checkedId });
    }
  }

  browser.menus.refresh();
});

browser.menus.onClicked.addListener(async (info) => {
  const choice = choiceFromMenuId(info.menuItemId);
  if (choice === null) return;

  const node = await markableBookmark(info.bookmarkId);
  if (!node) return;

  let title;
  if (choice === NO_CONTAINER) {
    title = withoutMarker(node.title, containers);
  } else {
    const identity = identities.find((candidate) => candidate.cookieStoreId === choice);
    if (!identity) return;
    title = withMarker(node.title, identity.name, containers);
  }

  if (title !== node.title) await browser.bookmarks.update(node.id, { title });
});

// Interception

function relocationTarget(tab, keepOriginal) {
  return {
    index: keepOriginal ? tab.index + 1 : tab.index,
    active: tab.active,
    windowId: tab.windowId,
  };
}

async function reopenInContainer(details) {
  const cookieStoreId = containerFor(urlIndex, details.url);
  if (cookieStoreId === null || details.tabId < 0) return {};

  let tab;
  try {
    tab = await browser.tabs.get(details.tabId);
  } catch {
    return {};
  }
  // Private windows have no containers.
  if (tab.incognito || tab.cookieStoreId === cookieStoreId) return {};

  const keepOriginal = !DISPOSABLE_TAB_URLS.has(tab.url);
  try {
    await browser.tabs.create({
      url: details.url,
      cookieStoreId,
      ...relocationTarget(tab, keepOriginal),
    });
  } catch (error) {
    // The container may be gone; let the request through.
    console.warn("Bookmark Containers: could not open", details.url, "in", cookieStoreId, error);
    return {};
  }

  if (!keepOriginal) browser.tabs.remove(tab.id).catch(() => {});
  return { cancel: true };
}

function listenFor(urls) {
  browser.webRequest.onBeforeRequest.addListener(
    reopenInContainer,
    { urls, types: ["main_frame"] },
    ["blocking"]
  );
}

function watchMarkedSites() {
  if (browser.webRequest.onBeforeRequest.hasListener(reopenInContainer)) {
    browser.webRequest.onBeforeRequest.removeListener(reopenInContainer);
  }
  const urls = markedHostPatterns(urlIndex);
  if (urls.length === 0) return;

  try {
    listenFor(urls);
  } catch (error) {
    // Narrowing is an optimisation, never a reason to lose the redirect.
    console.warn("Bookmark Containers: watching all sites instead", urls, error);
    listenFor(["http://*/*", "https://*/*"]);
  }
}

async function refreshIndex() {
  urlIndex = buildIndex(await browser.bookmarks.getTree(), containers);
  watchMarkedSites();
}

// A sync delivers edits in bursts, and each one costs a full tree scan.
let reindexTimer = null;
function scheduleReindex() {
  clearTimeout(reindexTimer);
  reindexTimer = setTimeout(refreshIndex, REINDEX_DELAY_MS);
}

async function containersChanged() {
  await refreshIdentities();
  await rebuildMenus();
  scheduleReindex();
}

browser.bookmarks.onCreated.addListener(scheduleReindex);
browser.bookmarks.onChanged.addListener(scheduleReindex);
browser.bookmarks.onRemoved.addListener(scheduleReindex);

browser.contextualIdentities.onCreated.addListener(containersChanged);
browser.contextualIdentities.onUpdated.addListener(containersChanged);
browser.contextualIdentities.onRemoved.addListener(containersChanged);

(async () => {
  await refreshIdentities();
  await rebuildMenus();
  await refreshIndex();
})();
