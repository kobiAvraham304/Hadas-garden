const box = document.querySelector('#healthResult');

fetch('/api/health', { cache:'no-store' })
  .then(async (response) => ({ response, data:await response.json() }))
  .then(({ response, data }) => {
    const checks = data.checks || {};
    const rows = [
      ['גרסת האתר', true, data.version || 'לא ידוע'],
      ['שלושת משתני Vercel', checks.environment?.ok, checks.environment?.ok ? 'תקין' : `חסרים: ${(checks.environment?.missing || []).join(', ')}`],
      ['חיבור ל-Supabase', checks.database?.ok, checks.database?.ok ? 'מחובר' : (checks.database?.error || 'לא מחובר')],
      ['סכמת בסיס הנתונים', checks.schema?.ok, checks.schema?.ok ? `גרסה ${checks.schema.version}` : (checks.schema?.error || `גרסה מותקנת: ${checks.schema?.version || 'אין'}`)],
      ['לינור ואילנית', checks.initialAccounts?.ok, checks.initialAccounts?.ok ? 'החשבונות מוכנים' : (checks.initialAccounts?.error || `נמצאו ${checks.initialAccounts?.count || 0} מתוך 2`)],
    ];
    box.innerHTML = rows.map(([label, ok, value]) => `
      <div class="setup-check ${ok ? 'ok' : 'error'}">
        <span>${label}</span><strong>${value}</strong>
      </div>`).join('');
    box.insertAdjacentHTML('beforeend', response.ok
      ? '<div class="notice success">המערכת מוכנה. אפשר להיכנס עם מספר הטלפון והסיסמה hadas.</div>'
      : '<div class="notice error">יש להשלים רק את הסעיפים המסומנים. אין עמוד setup ואין קודי הקמה.</div>');
  })
  .catch(() => {
    box.innerHTML = '<div class="notice error">לא ניתן להריץ את בדיקת המערכת.</div>';
  });
