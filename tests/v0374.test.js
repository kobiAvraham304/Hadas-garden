const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const read=p=>fs.readFileSync(p,'utf8');

test('0.37.4 shows Push onboarding after app login',()=>{const c=read('push-v0372.js');assert.match(c,/pushOnboardingDialog/);assert.match(c,/MutationObserver/);assert.match(c,/scheduleOnboarding/);assert.match(c,/הפעלת התראות/);});
test('0.37.4 requests permission only after user action',()=>{const c=read('push-v0372.js');assert.match(c,/enableBtn\.onclick=\(\)=>enable/);assert.match(c,/Notification\.requestPermission/);assert.doesNotMatch(c,/scheduleOnboarding\([^)]*Notification\.requestPermission/);});
test('0.37.4 handles iPhone Home Screen requirement',()=>{const c=read('push-v0372.js');assert.match(c,/הוספה למסך הבית/);assert.match(c,/isIOS&&!standalone/);});
test('0.37.4 does not nag users who enabled or postponed recently',()=>{const c=read('push-v0372.js');assert.match(c,/REMIND_AFTER_MS=7\*24\*60\*60\*1000/);assert.match(c,/saved\.status==='enabled'/);assert.match(c,/writeOnboarding\('later'\)/);});
