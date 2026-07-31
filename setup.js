const statusBox = document.getElementById('setupStatus');
const form = document.getElementById('setupForm');

function setStatus(message, type = '') {
  statusBox.className = `notice ${type}`.trim();
  statusBox.textContent = message;
}

async function checkStatus() {
  try {
    const response = await fetch('/api/bootstrap-status');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'שגיאה בבדיקת המערכת');
    if (data.needsBootstrap) {
      setStatus('המערכת מוכנה להקמה. הזינו את מספרי הטלפון של לינור ואילנית.', 'success');
      form.classList.remove('hidden');
    } else {
      setStatus('המערכת כבר הוקמה. ניתן לעבור למסך הכניסה.', 'success');
    }
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'מקים את המערכת…';
  try {
    const body = Object.fromEntries(new FormData(form).entries());
    const response = await fetch('/api/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ההקמה נכשלה');
    form.classList.add('hidden');
    setStatus('המערכת הוקמה בהצלחה. לינור ואילנית יכולות להתחבר עם הסיסמה הראשונית.', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'הקמת לינור ואילנית';
  }
});

checkStatus();
