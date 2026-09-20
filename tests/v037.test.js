const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('0.37 loads one smart-validation layer with current version metadata',()=>{
  const entry=read('patch-v025.js'),index=read('index.html'),pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.version,'0.37.0');
  assert.match(entry,/const VERSION = '0\.37\.0'/);
  assert.match(entry,/patch-v037\.js\?v=0370/);
  assert.match(entry,/await loadScript\(V037, 'v037'\)/);
  assert.match(index,/patch-v025\.js\?v=0362&r=0370/);
});

test('0.37 smart validation proposes before applying and revalidates after approval',()=>{
  const patch=read('patch-v037.js');
  assert.match(patch,/הצע פתרון/);
  assert.match(patch,/אשר ועדכן שיבוץ/);
  assert.match(patch,/fetchMatchingCandidates/);
  assert.match(patch,/action:'apply_suggestion'/);
  assert.match(patch,/maxSafe/);
  assert.match(patch,/refreshScheduleWeek\(\{force:true\}\)/);
  assert.match(patch,/__hadasV0345EnsureValidation/);
});

test('0.37 mobile controls stay user-driven and issue focus targets the actual week area',()=>{
  const patch=read('patch-v037.js');
  assert.match(patch,/toolsState/);
  assert.match(patch,/MutationObserver/);
  assert.match(patch,/mobile-week-day/);
  assert.match(patch,/scrollIntoView/);
  assert.match(patch,/stopImmediatePropagation/);
});
