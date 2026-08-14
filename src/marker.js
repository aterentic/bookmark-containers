"use strict";

// The trailing [Name] on a bookmark title is this extension's only state.
const TITLE_MARKER = /^(.*?)\s*\[([^\][]+)\]\s*$/;

function parseTitle(title) {
  const match = typeof title === "string" ? title.match(TITLE_MARKER) : null;
  return match ? { base: match[1], name: match[2] } : { base: title ?? "", name: null };
}

function containersByName(identities) {
  return new Map(identities.map((identity) => [identity.name.toLowerCase(), identity]));
}

// Only a group naming a real container is a marker, so a title like
// "Release [1234]" is left intact when a container is set on it.
function containerMarker(title, containers) {
  const { base, name } = parseTitle(title);
  return name !== null && containers.has(name.toLowerCase()) ? { base, name } : null;
}

function withoutMarker(title, containers) {
  return containerMarker(title, containers)?.base ?? title ?? "";
}

function withMarker(title, containerName, containers) {
  const base = withoutMarker(title, containers);
  return base ? `${base} [${containerName}]` : `[${containerName}]`;
}

// Requests carry no fragment, and only http(s) reaches the interceptor.
function normalizeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  return url.href;
}

function flattenBookmarks(nodes, found = []) {
  for (const node of nodes) {
    if (node.url) found.push(node);
    if (node.children) flattenBookmarks(node.children, found);
  }
  return found;
}

function markedBookmarks(nodes, containers) {
  return flattenBookmarks(nodes)
    .map((node) => ({ node, marker: containerMarker(node.title, containers) }))
    .filter(({ marker }) => marker !== null)
    .map(({ node, marker }) => ({ id: node.id, base: marker.base, name: marker.name, url: node.url }));
}

function buildIndex(nodes, containers) {
  const index = new Map();
  for (const { name, url } of markedBookmarks(nodes, containers)) {
    const key = normalizeUrl(url);
    if (key) index.set(key, containers.get(name.toLowerCase()).cookieStoreId);
  }
  return index;
}

function containerFor(index, url) {
  const key = normalizeUrl(url);
  return key === null ? null : index.get(key) ?? null;
}

// Match patterns cannot carry a port, so a marked URL on one widens to its host.
function markedHostPatterns(index) {
  const patterns = new Set();
  for (const key of index.keys()) {
    const { protocol, hostname } = new URL(key);
    patterns.add(`${protocol}//${hostname}/*`);
  }
  return [...patterns];
}
