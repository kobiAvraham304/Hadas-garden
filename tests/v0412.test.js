const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
test('schedule exports use Heebo for all weights, not device Arial',()=>{
 const start=app.indexOf('function drawWeeklyScheduleCanvas('),end=app.indexOf('async function canvasBlob(',start);
 assert.ok(start>0&&end>start);
 const canvas=app.slice(start,end);
 assert.ok(canvas.includes('900 42px Heebo'));
 assert.ok(canvas.includes('800 16px Heebo'));
 assert.doesNotMatch(canvas,/Arial/);
 assert.match(html,/family=Heebo/);
});
test('weekly PDF and weekly/monthly image exports await font loading',()=>{
 assert.match(app,/async function ensureScheduleExportFont\(\)/);
 assert.match(app,/document\.fonts\.load\(spec,sample\)/);
 assert.match(app,/!faces\.length \|\| !document\.fonts\.check/);
 for(const name of ['downloadScheduleImage','downloadMonthlyScheduleImage','printWeeklySchedule']){
  const from=app.indexOf('async function '+name+'()'),to=app.indexOf('\n}',from);
  assert.ok(from>0&&to>from);
  assert.match(app.slice(from,to),/await ensureScheduleExportFont\(\)/);
 }
});
test('0.40.14 version is consistent',()=>{
 assert.equal(require('../package.json').version,'0.40.14');
 assert.match(html,/app\.js\?v=0414/);
 assert.match(fs.readFileSync('patch-v025.js','utf8'),/const VERSION = '0\.40\.14'/);
});