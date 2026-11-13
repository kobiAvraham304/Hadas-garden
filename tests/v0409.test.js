const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const source=read('patch-v0342.js');
const helperSource=source.slice(source.indexOf('  function pdfShiftPalette('),source.indexOf('  function drawShiftCard('));
const {pdfShiftPalette,pdfClassPalette,pdfAbsencePalette}=new Function(helperSource+'return {pdfShiftPalette,pdfClassPalette,pdfAbsencePalette};')();
test('refined A4 role palette stays distinct but soft',()=>{
 const teacher=pdfShiftPalette({shift_role:'staff'},{job_title:'גננת'});
 const lead=pdfShiftPalette({shift_role:'staff'},{job_title:'סייעת מובילה'});
 const staff=pdfShiftPalette({shift_role:'staff'},null);
 const replacement=pdfShiftPalette({shift_role:'replacement'},null);
 assert.equal(teacher.fill,'#DCF0E0');assert.equal(lead.fill,'#EFE2F8');
 assert.equal(new Set([teacher.fill,lead.fill,staff.fill,replacement.fill]).size,4);
 assert.ok(source.includes('roundRect(ctx, x, y, width, height, 10, palette.fill, palette.border, .8)'));
});
test('approved vacation and recurring day off have different readable PDF styles',()=>{
 const approved=pdfAbsencePalette({absence_type:'leave'}),fixed=pdfAbsencePalette({absence_type:'fixed_day_off'});
 assert.equal(approved.fill,'#FBE4DC');assert.equal(fixed.fill,'#F2EEE8');
 assert.notEqual(approved.fill,fixed.fill);assert.notEqual(approved.text,fixed.text);
 assert.notEqual(pdfAbsencePalette({absence_type:'sick'}).fill,approved.fill);
 assert.notEqual(pdfAbsencePalette({absence_type:'day_off_worked'}).fill,fixed.fill);
 assert.ok(source.includes('const absenceStyle = pdfAbsencePalette(item);'));
 assert.ok(source.includes('const label = absencePdfLabel(item.absence_type)'));
});
test('A4 print remains a single 300 DPI landscape page and without the A4 heading',()=>{
 assert.match(source,/const SCALE = 2; \/\/ 3508 × 2480 pixels; 300 DPI/);
 assert.match(source,/const logicalWidth = 1754;/); assert.match(source,/const logicalHeight = 1240;/);
 assert.match(source,/const pageW = 841\.89;/);assert.match(source,/const pageH = 595\.28;/);
 assert.match(source,/canvas\.toBlob\(resolve, 'image\/jpeg', 0\.995\)/);
 assert.match(source,/context\.canvases=\[buildA4ScheduleCanvas\(\)\]/);
 assert.ok(!source.includes("'A4 לרוחב · עמוד אחד'"));
 assert.ok(source.includes('cardHeight = Math.max(1, Math.min(maxCard,'));
 assert.ok(source.includes('cardHeight = Math.max(1, Math.min(44,'));
});
test('classroom palettes and gentle decorative header are rendered with actual A4 exporter',()=>{
 assert.equal(new Set(['סיני','אודם','גלבוע'].map((n,i)=>pdfClassPalette({name:n},i).fill)).size,3);
 assert.match(source,/pdfClassIcon\(ctx, classItem\.name,/);
 assert.match(source,/ctx\.ellipse\(margin\+leaf\[0\]/);
 assert.match(source,/fillText/);
 assert.match(read('patch-v025.js'),/V0342 = '\/patch-v0342\.js\?v=0409'/);
 assert.match(read('index.html'),/patch-v025\.js\?v=0413/);
 assert.equal(JSON.parse(read('package.json')).version,'0.40.13');
});
