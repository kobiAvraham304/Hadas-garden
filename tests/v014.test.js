const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = (file) => fs.readFileSync(path.join(root,file),'utf8');

test('browser icons and WhatsApp/Open Graph preview assets are bundled',()=>{
  const html=read('index.html'); const manifest=JSON.parse(read('site.webmanifest'));
  for(const file of ['favicon.ico','favicon.svg','favicon-32x32.png','favicon-192x192.png','favicon-512x512.png','apple-touch-icon.png','og-image.png']) assert.ok(fs.existsSync(path.join(root,file)),file);
  assert.match(html,/property="og:title"/); assert.match(html,/property="og:image" content="https:\/\/hadas-garden-1\.vercel\.app\/og-image\.png"/);
  assert.match(html,/name="twitter:card" content="summary_large_image"/);
  assert.ok(manifest.icons.some((icon)=>icon.sizes==='192x192'));
  assert.ok(manifest.icons.some((icon)=>icon.sizes==='512x512'));
});

test('employee card is simplified and fixed assignments show only the class name',()=>{
  const app=read('app.js'); const css=read('styles.css');
  assert.doesNotMatch(app,/return `כיתה קבועה ·/);
  assert.match(app,/return classById\(employee\.primary_class_id\)\?\.name/);
  assert.match(app,/employee-registration-badge/);
  assert.doesNotMatch(app,/class="employee-login-state/);
  assert.match(css,/\.employee-registration-badge/);
});

test('employee form is divided into accessible sections with mobile navigation',()=>{
  const html=read('index.html'); const app=read('app.js'); const css=read('styles.css');
  for(const id of ['employeeBasicsSection','employeeAssignmentSection','employeeWorkSection','employeeScheduleSection','employeeConstraintsSection','employeeNotesSection']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/class="employee-form-nav"/);
  assert.match(app,/function handleEmployeeFormNav/);
  assert.match(css,/\.employee-form-nav/);
  assert.match(css,/\.employee-form-details/);
});

test('password reset has immediate busy feedback and a precise success message',()=>{
  const app=read('app.js'); const css=read('styles.css');
  assert.match(app,/מאפס סיסמה…/);
  assert.match(app,/אופסה ל-hadas/);
  assert.match(app,/button\.classList\.add\('is-busy'\)/);
  assert.match(css,/button\.is-busy::before/);
});
