const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('extra schedule tools remain accessible above and below tablet breakpoint',()=>{
 const css=read('styles.css'),app=read('app.js');
 assert.match(css,/@media\(min-width:821px\)\{\.schedule-tools-menu\{display:block!important\}/);
 assert.match(css,/\.schedule-tools-menu:not\(\[open\]\)>\.schedule-secondary-actions\{display:none!important\}/);
 assert.match(css,/@media\(max-width:820px\)\{\.schedule-tools-menu\[open\]>/);
 assert.match(app,/installScheduleToolsMenu\(\)/);
});
test('schedule menu toggles with tap keyboard and closes on outside press',()=>{
 const src=read('app.js');
 const block=src.slice(src.indexOf('function installScheduleToolsMenu()'),src.indexOf('function employeeDefaultHoursValues()'));
 const ev={},de={},summary={setAttribute(k,v){this[k]=v},addEventListener(k,fn){ev[k]=fn},focus(){this.focused=true}};
 const menu={open:false,dataset:{},querySelector:()=>summary,contains:v=>v===summary,addEventListener(){}};
 const doc={querySelector:()=>menu,addEventListener(k,fn){de[k]=fn}};
 new Function('document',block+'return installScheduleToolsMenu;')(doc)();
 ev.click({preventDefault(){}});assert.equal(menu.open,true);
 de.click({target:{}});assert.equal(menu.open,false);
 ev.keydown({key:'Enter',preventDefault(){}});assert.equal(menu.open,true);
 de.keydown({key:'Escape'});assert.equal(menu.open,false);
 assert.equal(summary.focused,true);
});
test('changing baseline hours asks for a clear choice and blocks saving until resolved',()=>{
 const s=read('app.js'),html=read('index.html');
 assert.match(s,/promptWeeklyDefaultHoursChoice/);
 assert.match(s,/if \(!\$\('#employeeDefaultHoursChoice'\)\.hidden\)/);
 for(const key of ['all','preserve','cancel'])assert.ok(html.includes('data-hours-choice="'+key+'"'));
 assert.match(s,/state\.employeeHoursBaseline=employeeDefaultHoursValues\(\)/);
});
test('apply all overwrites prior special workday hours but preserves day-off classification',()=>{
 const s=read('app.js'),block=s.slice(s.indexOf('function employeeDefaultHoursValues()'),s.indexOf('function renderWeeklyPatternFields(employee = {})'));
 const rows=[
   {dataset:{weekday:'0',hoursOverride:'false'},elements:{'.weekly-day-type':{value:'work'},'.weekly-start':{value:'07:30'},'.weekly-end':{value:'15:30'}}},
   {dataset:{weekday:'1',hoursOverride:'true'},elements:{'.weekly-day-type':{value:'work'},'.weekly-start':{value:'08:00'},'.weekly-end':{value:'13:00'}}},
   {dataset:{weekday:'2',hoursOverride:'false'},elements:{'.weekly-day-type':{value:'day_off'},'.weekly-start':{value:'07:30'},'.weekly-end':{value:'15:30'}}},
 ];
 for(const r of rows){r.classList={toggle(){}};r.elements['.v0403-hours-badge']={};r.elements['.v0403-reset-hours']={};}
 const form={elements:{default_start:{value:'09:00'},default_end:{value:'15:00'}}};
 const state={employeeHoursBaseline:{start:'07:30',end:'15:30'}},notice={hidden:false,classList:{toggle(){}}};
 const $=(q,r)=>r?r.elements[q]:({'#employeeForm':form,'#employeeDefaultHoursChoice':notice}[q]);
 const fn=new Function('$','$$','state','trimTime','timeToMinutes','showToast',block+'return handleWeeklyDefaultHoursChoice;')(
   $,(q)=>rows,state,s=>s, s=>{const[h,m]=s.split(':').map(Number);return h*60+m},()=>{});
 fn({target:{closest:()=>({dataset:{hoursChoice:'all'}})}});
 assert.equal(rows[0].elements['.weekly-start'].value,'09:00');
 assert.equal(rows[1].elements['.weekly-start'].value,'09:00');
 assert.equal(rows[2].elements['.weekly-start'].value,'07:30');
});
test('preserve path retains exceptional hours and updates inherited hours',()=>{
 const s=read('app.js');assert.match(s,/else if\(action==='preserve'\)/);
 assert.match(s,/syncInheritedWeeklyHours\(\)/);
 assert.match(s,/if\(\$\(\'\.weekly-day-type\',row\)\.value!==\'work\'\)return/);
 assert.match(read('index.html'),/styles\.css\?v=0404/);
});