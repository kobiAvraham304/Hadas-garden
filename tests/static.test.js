const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function allProjectText(){
  const files=fs.readdirSync(root,{recursive:true,withFileTypes:true})
    .filter(e=>e.isFile()).map(e=>path.join(e.parentPath||e.path,e.name))
    .filter(f=>!f.includes(`${path.sep}tests${path.sep}`)&&!f.endsWith('.zip'))
    .filter(f=>/\.(js|html|sql|md|json|css|example)$/.test(f));
  return files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
}

test('all fixed ID selectors used by app.js exist in index.html', () => {
  const html = read('index.html'); const js = read('app.js');
  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]));
  const used = new Set([...js.matchAll(/\$\(["']#([A-Za-z0-9_-]+)["']/g)].map(m=>m[1]));
  assert.deepEqual([...used].filter(id=>!ids.has(id)), []);
});

test('project contains phone login only and no bundled secret value', () => {
  const content=allProjectText();
  assert.doesNotMatch(content, /@hadas\.local/i);
  assert.doesNotMatch(content, /signInWithPassword|auth\.signIn/i);
  assert.doesNotMatch(content, /sb_secret_[A-Za-z0-9_-]{20,}/i);
  assert.match(read('index.html'), /מספר טלפון/);
});

test('setup complexity was removed completely', () => {
  const content=allProjectText(); const vercel=JSON.parse(read('vercel.json'));
  assert.equal(fs.existsSync(path.join(root,'setup.html')),false);
  assert.equal(fs.existsSync(path.join(root,'api/bootstrap.js')),false);
  assert.doesNotMatch(read('README.md'),/BOOTSTRAP_TOKEN|SESSION_PEPPER|APP_URL|\/setup/);
  assert.ok(!vercel.rewrites.some(item=>item.source==='/setup'));
  const example=read('.env.example');
  const vars=[...example.matchAll(/^([A-Z0-9_]+)=/gm)].map(m=>m[1]);
  assert.deepEqual(vars,['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY']);
  assert.doesNotMatch(content,/process\.env\.(BOOTSTRAP_TOKEN|SESSION_PEPPER|APP_URL)/);
});

test('Vercel security headers and health route are present without a conflicting Node override', () => {
  const pkg=JSON.parse(read('package.json')); const vercel=JSON.parse(read('vercel.json'));
  assert.equal(pkg.version,'0.4.2'); assert.equal(Object.hasOwn(pkg,'engines'),false);
  assert.ok(vercel.rewrites.some(item=>item.source==='/health'&&item.destination==='/health.html'));
  const raw=read('vercel.json');
  for(const header of ['Content-Security-Policy','X-Content-Type-Options','X-Frame-Options','Cross-Origin-Resource-Policy']) assert.match(raw,new RegExp(header));
});

test('initial accounts are seeded by the single SQL file with valid roles', () => {
  const schema=read('supabase/schema.sql');
  assert.match(schema,/אילנית זאדייב/); assert.match(schema,/\+972544594513/); assert.match(schema,/'admin'/);
  assert.match(schema,/לינור אברהם/); assert.match(schema,/\+972542521780/); assert.match(schema,/'scheduler'/);
  assert.match(schema,/v_initial_hash/); assert.match(schema,/'0\.4\.1'/);
  assert.match(schema,/ENABLE ROW LEVEL SECURITY/i); assert.match(schema,/REVOKE ALL ON TABLE/i);
  assert.match(schema,/hadas_realtime_public_read/); assert.match(schema,/ALTER PUBLICATION supabase_realtime ADD TABLE/i);
});

test('client includes resilient sync, mobile schedule views, filters and responsive employee cards', () => {
  const app=read('app.js'); const css=read('styles.css'); const html=read('index.html');
  assert.match(app,/timeoutSignal/); assert.match(app,/attempts=method==='GET'\?2:1/); assert.match(app,/state\.refreshing/);
  for(const mode of ['week','day','mine']) assert.match(html,new RegExp(`data-mode="${mode}"`));
  assert.match(app,/renderScheduleDay/); assert.match(app,/renderScheduleMine/);
  assert.match(app,/requestStatusFilter/); assert.match(app,/employeeStatusFilter/);
  assert.match(app,/renderNavBadges/); assert.match(css,/\.employee-mobile/); assert.match(css,/position:fixed;inset:auto 0 0 0/);
  assert.match(css,/prefers-reduced-motion/);
});

test('client date formatting supports both date-only and timestamp values', () => {
  const app=read('app.js'); assert.match(app,/function parseDateValue/); assert.match(app,/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
});

test('non-manager employee payload excludes private employment fields', () => {
  const dataApi=read('api/data.js'); const baseBlock=dataApi.match(/const base = \{([\s\S]*?)\n  \};/)?.[1]||'';
  assert.doesNotMatch(baseBlock,/weekly_hours|employment_percent|fixed_day_off|started_at|ended_at|admin_notes|phone/);
  assert.match(dataApi,/if \(manager\)/);
});

test('health page is CSP-compatible and confirms automatic account creation', () => {
  const html=read('health.html'); const js=read('health.js');
  assert.match(html,/src="\/health\.js"/); assert.doesNotMatch(html,/<script>[^<]/);
  assert.match(js,/לינור ואילנית/); assert.match(js,/אין עמוד setup ואין קודי הקמה/);
});

test('runtime avoids unsafe dynamic JavaScript and inline DOM handlers', () => {
  const app=read('app.js'); const html=read('index.html');
  assert.doesNotMatch(app,/\beval\s*\(|new Function|document\.write/);
  assert.doesNotMatch(html,/\son[a-z]+\s*=/i);
});
