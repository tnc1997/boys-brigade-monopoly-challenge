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
    assert.match(sw, /url\.origin !== self\.location\.origin/);
  });
});
