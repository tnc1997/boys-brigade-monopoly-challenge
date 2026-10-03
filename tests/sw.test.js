import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');

/** Reads a list of strings, like `const NAME = ['a', 'b'];`, from the service worker. */
const listIn = (name) => {
  const match = sw.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  assert.ok(match, `${name} not found in sw.js`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
};

describe('service worker', () => {
  test('saves every top-level module, except itself', () => {
    const modules = readdirSync(root).filter((file) => file.endsWith('.js') && file !== 'sw.js');
    const appFiles = listIn('APP_FILES');
    for (const module of modules) {
      assert.ok(appFiles.includes(module), `${module} is missing from APP_FILES in sw.js`);
    }
  });

  test('saves the page and the styles', () => {
    const appFiles = listIn('APP_FILES');
    for (const file of ['./', 'index.html', 'styles.css']) {
      assert.ok(appFiles.includes(file), `${file} is missing from APP_FILES in sw.js`);
    }
  });

  test('saves the same library versions the page loads', () => {
    const loaded = [...index.matchAll(/(?:href|src)="(https:\/\/cdnjs\.cloudflare\.com\/[^"]+)"/g)].map(([, url]) => url).sort();
    assert.deepEqual(listIn('LIBRARY_FILES').sort(), loaded);
  });

  test("doesn't save map tiles, which the tile usage policy doesn't allow offline", () => {
    assert.doesNotMatch(sw, /tile\.openstreetmap\.org\/\{|cache\.put\([^)]*tile/);
    // Tiles aren't app files, so they're passed straight to the network.
    assert.match(sw, /if \(!APP_FILE_URLS\.has\(key\)\) \{\s*return;/);
  });
});

describe('service worker saving', () => {
  test('only saves successful responses', () => {
    assert.match(sw, /async function saveResponse\(key, response\) \{\s*if \(response\.ok\)/);
  });

  test("doesn't let a failure to save Leaflet fail the install", () => {
    const saveLibraryFile = sw.slice(sw.indexOf('async function saveLibraryFile'), sw.indexOf("self.addEventListener('install'"));
    assert.match(saveLibraryFile, /try \{[\s\S]*\} catch \{/);
  });

  test('reuses a saved copy of Leaflet before downloading it, and tries again when activating', () => {
    assert.match(sw, /const existing = copies\.find\(\(copy\) => copy\?\.ok\);/);
    const activate = sw.slice(sw.indexOf("self.addEventListener('activate'"), sw.indexOf("self.addEventListener('fetch'"));
    assert.ok(activate.indexOf('saveLibraryFile') < activate.indexOf('caches.delete'), 'Leaflet is saved before old caches are deleted');
  });

  test("only handles the app's own files, saved without query strings", () => {
    assert.match(sw, /if \(!APP_FILE_URLS\.has\(key\)\) \{\s*return;/);
    assert.match(sw, /const key = `\$\{url\.origin\}\$\{url\.pathname\}`;/);
  });

  test("installs fresh copies, bypassing the browser's HTTP cache", () => {
    assert.match(sw, /new Request\(file, \{ cache: 'reload' \}\)/);
  });
});

describe('service worker caches', () => {
  test("only deletes this app's own old caches, since other sites share the storage", () => {
    assert.match(sw, /const names = await appCacheNames\(\);\s*await Promise\.all\(names\.filter\(\(name\) => name !== CACHE_NAME\)/);
    assert.match(sw, /const CACHE_NAME = `\$\{CACHE_PREFIX\}v\d+`;/);
  });

  test('uses the saved copy for error responses (4xx and 5xx), passing redirects on', () => {
    assert.match(sw, /loaded\.status >= 400 \? \(\(await saved\(\)\) \?\? loaded\) : loaded/);
    assert.match(sw, /Promise\.race\(\[usable,/);
  });

  test("only reads this app's caches, without creating them", () => {
    // Every lookup names the cache to search; a bare caches.match would
    // search other sites' caches too.
    const lookups = [...sw.matchAll(/caches\.match\(([^)]*)\)/g)].map(([, args]) => args);
    assert.ok(lookups.length > 0);
    for (const args of lookups) {
      assert.match(args, /\{ cacheName(: CACHE_NAME)? \}/, `caches.match(${args}) doesn't name a cache`);
    }
    assert.match(sw, /name\.startsWith\(CACHE_PREFIX\)\)/);
  });
});
