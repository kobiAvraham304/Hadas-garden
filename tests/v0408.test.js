const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');

const script=read('patch-v0342.js');
const first=script.indexOf('  function pdfShiftPalette(shift, employee) {');
const last=script.indexOf('  function drawShiftCard(ctx, shift, x, y, width, height) {',first);
assert.ok(first>=0 && last>first,'A4 PDF renderer must own the palettes');
const palettes=new Function(script.slice(first,last)+'return {pdfShiftPalette,pdfClassPalette};')();

function colorDistanceFromWhite(hex){
 const c=hex.slice(1).match(/../g).map(x=>parseInt(x,16));
 return c.reduce((s,n)=>s+(255-n),0);
}

test('A4 PDF assigns clear green to teachers and purple to lead assistants even if shift role is staff',()=>{
 const staffShift={shift_role:'staff'};
 const teacher=palettes.pdfShiftPalette(staffShift,{job_title:'גננת'});
 const lead=palettes.pdfShiftPalette(staffShift,{job_title:'סייעת מובילה'});
 assert.equal(teacher.fill,'#DCF0E0');
 assert.equal(lead.fill,'#EFE2F8');
 assert.ok(colorDistanceFromWhite(teacher.fill)>45);
 assert.ok(colorDistanceFromWhite(lead.fill)>45);
 assert.notEqual(teacher.fill,lead.fill);
 assert.equal(palettes.pdfShiftPalette({shift_role:'teacher'},null).fill,teacher.fill);
 assert.equal(palettes.pdfShiftPalette({shift_role:'lead'},null).fill,lead.fill);
 const others=['staff','replacement'].map(role=>palettes.pdfShiftPalette({shift_role:role},null).fill);
 assert.equal(new Set([teacher.fill,lead.fill,...others]).size,4);
});

test('class labels and row bands remain distinct for the three classrooms',()=>{
 const names=['סיני','אודם','גלבוע'];
 const groups=names.map((name,i)=>palettes.pdfClassPalette({name},i));
 assert.equal(new Set(groups.map(g=>g.fill)).size,3);
 assert.equal(new Set(groups.map(g=>g.row)).size,3);
 for(const g of groups){
  assert.match(g.fill,/^#[0-9a-f]{6}$/i);
  assert.ok(colorDistanceFromWhite(g.fill)>35);
 }
 assert.ok(script.includes('ctx.fillStyle = classPalette.row'));
 assert.ok(script.includes('roundRect(ctx, classColumnX + 7, y + 7, classColumnWidth - 14, h - 14'));
 assert.ok(script.includes('pdfClassIcon(ctx, classItem.name,'));
});

test('active PDF card renderer really paints palette colors for compact and regular shifts',()=>{
 const start=script.indexOf('  function drawShiftCard(ctx, shift, x, y, width, height) {');
 const end=script.indexOf('  function absenceEntriesForDate(',start);
 assert.ok(start>=0 && end>start);
 const rounded=[],fills=[],texts=[];
 const make=new Function('employeeById','pdfShiftPalette','roleMark','trimTime','roundRect','fitText',
  script.slice(start,end)+'return drawShiftCard;');
 const employeeById=id=>({t:{full_name:'גננת בדיקה',job_title:'גננת'},l:{full_name:'מובילה בדיקה',job_title:'סייעת מובילה'}}[id]);
 const renderer=make(employeeById,palettes.pdfShiftPalette,()=>'',v=>v,
  (ctx,x,y,w,h,r,fill,stroke)=>rounded.push({fill,stroke}),
  (ctx,str,x,y,options)=>texts.push({str,options}));
 const ctx={fillStyle:null,fillRect(x,y,w,h){fills.push({fill:this.fillStyle,x,y,w,h});}};
 renderer(ctx,{employee_id:'t',shift_role:'staff',start_time:'08:00',end_time:'15:00'},0,0,220,45);
 renderer(ctx,{employee_id:'l',shift_role:'staff',start_time:'08:00',end_time:'15:00'},0,50,220,30);
 assert.deepEqual(rounded.map(x=>x.fill),['#DCF0E0','#EFE2F8']);
 assert.deepEqual(fills.map(x=>x.fill),['#709D7D','#A27DB9']);
 assert.equal(texts.length,3);
});

test('unified weekly and monthly PDF exports call the corrected A4 renderer',()=>{
 assert.match(script,/context\.canvases=\[buildA4ScheduleCanvas\(\)\]/);
 assert.match(script,/canvas:buildA4ScheduleCanvas\(\{/);
 assert.match(script,/const palette = pdfShiftPalette\(shift, employee\)/);
 assert.match(script,/drawShiftCard\(ctx, shift,/);
 assert.match(script,/pdfFromCanvases\(context\.canvases\)/);
 const bootstrap=read('patch-v025.js');
 assert.match(bootstrap,/V0342 = '\/patch-v0342\.js\?v=0409'/);
 assert.equal(JSON.parse(read('package.json')).version,'0.40.13');
 assert.match(read('index.html'),/patch-v025\.js\?v=0413/);
});
