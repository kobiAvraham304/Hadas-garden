const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const read = file => fs.readFileSync(join(root,file),'utf8');

test('automatic scheduling saves draft despite undecided validation issues',async()=>{
  const patch = read('patch-v027.js');
  const wrapper=patch.match(/applyAutomaticSchedule = async function v027ApplyAutomaticSchedule\(\) \{[\s\S]*?\n  \};/);
  assert.ok(wrapper,'v027 wrapper exists');
  let called=0;
  const fn=new Function('previousApplyAutomaticSchedule', 'let applyAutomaticSchedule; '+wrapper[0]+' return applyAutomaticSchedule;')(
    async()=>{called++; return true;}
  );
  assert.equal(await fn(),true);
  assert.equal(called,1);
  assert.doesNotMatch(wrapper[0],/undecided|decisions|hard\.length/);
});
test('server retains essential safety checks but allows staffing issues at draft stage',()=>{
  const backend=read('handlers/shifts.js');
  assert.match(backend,/const unsafeCodes = new Set\(\['overlap','outside_opening_hours','approved_absence','forbidden_class','teacher_fixed_class'\]\)/);
  assert.match(backend,/unsafeErrors\.length/);
  const app=read('app.js');
  assert.match(app,/allow_incomplete:true/);
});
test('revalidation preserves options and returns the updated plan',()=>{
  const patch=read('patch-v027.js');
  assert.match(patch,/previousRevalidateAutomaticPreview\(\{ render:false \}\)/);
  assert.match(patch,/if \(options.render !== false && updated\)/);
  assert.match(patch,/return updated;/);
});
test('new leave request defaults date fields to the current month and resets Safari native picker',()=>{
  const app=read('app.js');
  const extract=app.match(/function initializeRequestDateInput\(input, value\) \{[\s\S]*?\n\}/);
  assert.ok(extract);
  const initialize=new Function('navigator',extract[0]+'; return initializeRequestDateInput;')({userAgent:'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit Safari'});
  const field={type:'date',value:'2026-07-01',defaultValue:'2026-07-01'};
  initialize(field,'2026-10-15');
  assert.equal(field.type,'date');
  assert.equal(field.value,'2026-10-15');
  assert.equal(field.defaultValue,'2026-10-15');
  const opener=app.match(/function openRequestDialog\(options=\{\}\) \{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(opener,/const today = dateISO\(new Date\(\)\)/);
  assert.match(opener,/initializeRequestDateInput\(form.elements.request_date, options.date \|\| today\)/);
  assert.match(opener,/initializeRequestDateInput\(form.elements.request_end_date, options.endDate \|\| options.date \|\| today\)/);
});
