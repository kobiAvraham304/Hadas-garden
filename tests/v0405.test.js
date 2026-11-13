const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = app.indexOf('function initializeWindows24HourFields() {');
const end = app.indexOf('\ninitializeWindows24HourFields();', start);
assert.ok(start >= 0 && end > start);
const initializer = app.slice(start, end);
const build = (values, userAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64)',pointer='fine') => {
  const controls=values.map(({value='',min=null,max=null}={})=>{
    const listeners={};
    return {
      dataset:{},type:'time',value,lang:'',pattern:'',setCustomValidity(v){this.validationMessage=v;},
      getAttribute(k){if(k==='min')return min;if(k==='max')return max;return null;},
      addEventListener(k,cb){listeners[k]=cb;},dispatch(k){listeners[k]?.();},
      listeners,validationMessage:''
    };
  });
  const document={body:{},querySelectorAll(sel){assert.equal(sel,'input[type="time"]');return controls;}};
  class MutationObserver { constructor(fn){this.fn=fn;this.instance=this;}observe(){} }
  const init=new Function('navigator','document','MutationObserver','window',initializer+'; return initializeWindows24HourFields;')({userAgent},document,MutationObserver,{matchMedia:()=>({matches:pointer==='fine'})});
  init();
  return controls;
};
test('Windows: shift start 07:30 and exit 15:30 are accepted by both native pattern and custom validator',()=>{
  const [start,end]=build([{value:'07:30'},{value:'15:30',max:'15:30'}]);
  for(const field of [start,end]){
    assert.equal(field.type,'text'); // Windows 24-hour controls
    assert.equal(field.validationMessage,'');
    assert.equal(new RegExp('^(?:'+field.pattern+')$').test(field.value),true);
    field.dispatch('focus');
    assert.equal(field.validationMessage,'');
  }
});
test('Windows: 730, 0730 and 7:30 normalize into 07:30, including blur',()=>{
 for(const value of ['730','0730','7:30']){
  const [field]=build([{value}]);
  field.dispatch('blur');
  assert.equal(field.value,'07:30');
  assert.equal(field.validationMessage,'');
 }
});
test('Windows: valid new value clears old error; out-of-range and invalid clock still rejected',()=>{
 const [field]=build([{value:'24:30',min:'07:30',max:'15:30'}]);
 assert.match(field.validationMessage,/שעה תקינה/);
 field.value='07:30';field.dispatch('input');field.dispatch('change');
 assert.equal(field.validationMessage,'');
 for(const value of ['25:00','12:65','06:59','15:31']){
  field.value=value;field.dispatch('blur');assert.notEqual(field.validationMessage,'',value);
 }
});
test('Windows: time value assigned by code is validated correctly on focus and change',()=>{
 const [field]=build([{value:'',max:'12:00'}]);
 field.value='11:45';field.dispatch('focus');assert.equal(field.validationMessage,'');
 field.value='12:01';field.dispatch('change');assert.notEqual(field.validationMessage,'');
 field.value='12:00';field.dispatch('change');assert.equal(field.validationMessage,'');
});
test('macOS desktop: type 0730 without colon; iPhone native time picker stays available',()=>{
 const [mac]=build([{value:'0730'}],'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)','fine');
 assert.equal(mac.type,'text');
 assert.equal(mac.value,'07:30');
 const [phone]=build([{value:'07:30'}],'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)','coarse');
 assert.equal(phone.type,'time');
 assert.equal(phone.dataset.hadas24h,undefined);
});
test('do not double-attach Windows time listeners on repeated calls',()=>{
 const [field]=build([{value:'08:00'}]);
 assert.equal(Object.keys(field.listeners).length,4);
 assert.equal(field.dataset.hadas24h,'true');
});
