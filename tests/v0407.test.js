const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('0.40.8 mobile tools are button-driven and independent of Safari details toggles',()=>{
 const html=read('index.html'),js=read('app.js'),css=read('styles.css');
 assert.match(html,/class="schedule-tools-trigger" aria-expanded="false" aria-controls="scheduleSecondaryActions"/);
 assert.match(html,/id="scheduleSecondaryActions" class="schedule-secondary-actions" hidden/);
 assert.doesNotMatch(html,/<details class="schedule-tools-menu">/);
 assert.match(js,/menu\.toggleAttribute\('open', Boolean\(opened\)\)/);
 assert.match(js,/actions\.hidden = !opened/);
 assert.match(js,/viewportMenuInitialized === 'true'/);
 assert.doesNotMatch(js,/addEventListener\('resize', debounce\(syncScheduleToolsForViewport/);
 assert.match(css,/\.schedule-command-bar:has\(\.schedule-tools-menu\[open\]\)\{overflow:visible!important\}/);
 assert.match(read('patch-v033.js'),/setScheduleToolsOpen\(tools,/);
});
test('weekly PDF uses distinct, clearly visible fill colors for every staffing role',()=>{
 const js=read('app.js');
 const begin=js.indexOf('function exportRolePalette(role) {');
 const end=js.indexOf('function weeklyExportLayout(',begin);
 assert.ok(begin>=0&&end>begin);
 const palette=new Function(js.slice(begin,end)+'return exportRolePalette;')();
 const roles=['teacher','lead','staff','replacement'];
 const fills=roles.map(role=>palette(role).fill);
 assert.equal(new Set(fills).size,4);
 assert.equal(palette('teacher').fill,'#d8f0e1');
 assert.equal(palette('lead').fill,'#e5dcf7');
 assert.equal(palette('staff').fill,'#eef0f8');
 assert.equal(palette('replacement').fill,'#ffe9c3');
 for(const file of ['app.js','patch-v026.js']){
  assert.match(read(file),/fillRoundedRect\(ctx, cellRight - 12, cardY \+ 4, 4, 26, 2, palette\.accent\)/);
 }
 const legacy=read('patch-v026.js');
 assert.match(legacy,/type === 'leave'\) return \{ fill: '#fff0c4'/);
 assert.match(legacy,/\/ColorSpace \/DeviceRGB/);
});
test('asset cache busting and version number follow 0.40.8',()=>{
 const html=read('index.html'),boot=read('patch-v025.js'),pkg=require('../package.json');
 assert.equal(pkg.version,'0.40.8');
 for(const asset of ['styles.css','app.js'])assert.ok(html.includes(asset+'?v=0407'));
 assert.ok(html.includes('patch-v025.js?v=0408'));
 assert.match(boot,/patch-v0342\.js\?v=0408/);
 assert.match(boot,/patch-v026\.js\?v=0407/);
 assert.match(boot,/patch-v033\.js\?v=0407/);
});
