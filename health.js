const box = document.querySelector('#healthResult');

fetch('/api/health', { cache:'no-store' })
  .then(async (response) => ({ response, data:await response.json() }))
  .then(({ response, data }) => {
    const checks = data.checks || {};
    const rows = [
      ['גרסת האתר', true, data.version || 'לא ידוע'],
      ['שלושת משתני Vercel', checks.environment?.ok, checks.environment?.ok ? 'תקין' : `חסרים: ${(checks.environment?.missing || []).join(', ')}`],
      ['חיבור ל־Supabase', checks.database?.ok, checks.database?.ok ? 'מחובר' : (checks.database?.error || 'לא מחובר')],
      ['גרסת בסיס הנתונים', checks.schema?.ok, checks.schema?.ok ? `גרסה ${checks.schema.version}` : (checks.schema?.error || `מותקנת: ${checks.schema?.version || 'לא נמצאה'}`)],
      ['לינור ואילנית', checks.initialAccounts?.ok, checks.initialAccounts?.ok ? 'החשבונות קיימים' : (checks.initialAccounts?.error || `נמצאו ${checks.initialAccounts?.count || 0} מתוך 2`) ],
    ];
    box.innerHTML = rows.map(([label, ok, value]) => `
      <div class="health-check ${ok ? 'ok' : 'error'}">
        <span>${label}</span><strong>${value}</strong>
      </div>`).join('');
    box.insertAdjacentHTML('beforeend', response.ok
      ? '<div class="notice success">המערכת מוכנה לעבודה.</div>'
      : '<div class="notice error">בגרסה קיימת יש להריץ פעם אחת את supabase/update-v0.27.0.sql, ולאחר מכן לרענן את הדף.</div>');
  })
  .catch(() => {
    box.innerHTML = '<div class="notice error">לא ניתן להריץ את בדיקת המערכת. בדוק שהפריסה ב־Vercel הסתיימה ב־Ready.</div>';
  });
