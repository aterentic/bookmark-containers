// Keep development-only files out of the .zip uploaded to addons.mozilla.org.
export default {
  ignoreFiles: [
    "assets",
    "test",
    "package.json",
    "package-lock.json",
    "web-ext-config.mjs",
    "README.md",
  ],
};
