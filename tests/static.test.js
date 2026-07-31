const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

test('all fixed ID selectors used by app.js exist in index.html', () => {
  const html = read('index.html');
  const js = read('app.js');
  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const used = new Set([...js.matchAll(/\$\(["']#([A-Za-z0-9_-]+)["']/g)].map((match) => match[1]));
  const missing = [...used].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('project contains no email-login fallback and no bundled secret value', () => {
  const files = fs.readdirSync(root, { recursive:true, withFileTypes:true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath || entry.path, entry.name))
    .filter((file) => !file.includes(`${path.sep}tests${path.sep}`))
    .filter((file) => /\.(js|html|sql|md|json|example)$/.test(file));
  const content = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(content, /@hadas\.local/i);
  assert.doesNotMatch(content, /signInWithPassword|auth\.signIn/i);
  assert.doesNotMatch(content, /sb_secret_[A-Za-z0-9_-]{20,}/i);
});

test('Vercel security headers and private Supabase schema are present', () => {
  const vercel = read('vercel.json');
  const schema = read('supabase/schema.sql');
  assert.match(vercel, /Content-Security-Policy/);
  assert.match(vercel, /X-Frame-Options/);
  assert.match(schema, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(schema, /REVOKE ALL ON TABLE/i);
  assert.match(schema, /hadas_realtime_public_read/);
});
