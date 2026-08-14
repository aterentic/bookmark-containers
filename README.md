# Bookmark Containers

Firefox extension that sets a container on a bookmark, so it always opens there.

Right-click a bookmark → **Set container** → pick one. The container is written into the
bookmark's name as a `[Container]` suffix: `Gmail` becomes `Gmail [Work]`. That suffix is the
extension's only state, so a setting syncs with the bookmark, survives uninstalling the
extension, and can be edited by hand. The URL is never touched, so favicons and everything else
about the bookmark are unaffected.

## Install

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select `manifest.json`

Temporary add-ons are gone when Firefox closes; permanent installation needs a signed build.
Prefer this over `web-ext run`, which starts a scratch profile with no bookmarks or containers.

```sh
npm test           # unit tests, and background tests against a fake browser
npm run build      # .zip in web-ext-artifacts/, for signing at addons.mozilla.org
```

Containers must be enabled (`privacy.userContext.enabled`, on by default since Firefox 91).

## How it works

- The marker is the trailing `[...]` group of a bookmark title, and counts only if it names an
  existing container, matched case-insensitively. A title like `Release [1234]` is left alone,
  including when a container is set on it.
- The bookmark tree is scanned into an index of URL → container at startup and whenever bookmarks
  or containers change. Bursts of edits collapse into one rescan.
- A blocking `webRequest` listener cancels navigations to an indexed URL that are heading for the
  wrong container, and reopens the URL in a tab belonging to the right one. Nothing is fetched in
  the wrong container first.
- That listener is registered for the marked hosts alone, not for every site. Match patterns
  cannot carry a port, so a marked URL on one widens to its host; the exact URL is still checked
  before anything is redirected.
- A navigation started in a blank or new tab closes that tab. Otherwise the original tab keeps
  its page and the container tab opens beside it.

## Caveats

- The suffix is visible in bookmark labels, and a long title may be truncated before you see it.
- Renaming a container orphans bookmarks carrying its old name: they open normally, and the stale
  name stays visible until you fix it.
- Matching is by URL, not by click origin, so any top-level navigation to a marked URL is
  redirected — not only bookmark clicks. Firefox exposes no way to tell them apart at
  cancel-time.
- Two bookmarks with the same URL and different containers conflict; the last one indexed wins.
- Only `http` and `https` bookmarks can be marked. The URL fragment is ignored when matching.
- Private windows are left alone; containers do not apply there.

## Why Manifest V2

The listener must block a navigation to redirect it, and it is registered for the marked hosts
only, which changes as bookmarks change. Manifest V3 backgrounds are event pages that must
register their listeners synchronously at the top level to be woken, so an MV3 port would have to
watch every site on every wake-up — broader access for no gain.

## License

MIT — see [LICENSE](LICENSE).
