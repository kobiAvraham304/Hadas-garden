const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const forbidden = [/sb_secret_[A-Za-z0-9_-]{20,}/i, /SUPABASE_SECRET_KEY\s*=\s*sb_[A-Za-z0-9_-]{20,}/i];
const extensions = new Set(['.js', '.html', '.css', '.md', '.json', '.sql', '.example']);
const skip = new Set(['node_modules', '.git']);
let failures = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name)) || entry.name.startsWith('.env')) {
      const text = fs.readFileSync(full, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(text) && !full.endsWith('scripts/check.js')) {
          console.error(`Secret-like value found in ${path.relative(root, full)}`);
          failures++;
        }
      }
    }
  }
}
walk(root);
if (failures) process.exit(1);
console.log('Security scan passed: no Supabase secret key is bundled.');
