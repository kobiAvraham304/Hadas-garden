const previousHandler = require('./shifts-v025');
const { parseBody, db, assertDb, send, handleError, httpError } = require('./server');

function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function getSunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'תאריך השבוע שנבחר אינו תקין');
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
async function generalDaysOff(dates) {
  const clean = [...new Set((dates || []).map(String).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))];
  if (!clean.length) return [];
  return assertDb(await db().from('hadas_calendar_events')
    .select('id,event_date,title,description')
    .eq('is_general_day_off', true)
    .in('event_date', clean), 'לא ניתן לבדוק ימים חופשיים כלליים') || [];
}
async function assertDateOpen(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return;
  const closures = await generalDaysOff([date]);
  if (closures.length) {
    const closure = closures[0];
    throw httpError(409, `המעון מוגדר סגור בתאריך זה: ${closure.title || 'יום חופשי כללי'}. יש לשנות את האירוע בלוח השנה לפני יצירת שיבוץ.`);
  }
}

module.exports = async function shiftsV027(req, res) {
  try {
    const body = parseBody(req);
    const action = String(body.action || '');

    if (req.method !== 'GET') {
      const directDate = body.shift_date || (action === 'move' ? body.shift_date : null);
      if (directDate && !['auto_preview','auto_apply','publish_preview','publish','copy_preview','copy_apply','clear_week'].includes(action)) {
        await assertDateOpen(directDate);
      }
    }

    if (req.method === 'POST' && ['auto_preview','auto_apply'].includes(action)) {
      const weekStart = getSunday(String(body.week_start || new Date().toISOString().slice(0, 10)));
      const requested = Array.isArray(body.selected_dates) && body.selected_dates.length
        ? [...new Set(body.selected_dates.map(String))]
        : Array.from({ length: 6 }, (_, index) => addDays(weekStart, index));
      const closures = await generalDaysOff(requested);
      if (closures.length) {
        const closed = new Set(closures.map((row) => row.event_date));
        const filtered = requested.filter((date) => !closed.has(date));
        if (!filtered.length) {
          return send(res, 409, {
            ok: false,
            error: 'כל הימים שנבחרו מוגדרים כימים חופשיים כלליים בלוח השנה. אין צורך ליצור עבורם שיבוץ.',
            closed_dates: closures,
          });
        }
        req.body = { ...body, selected_dates: filtered, general_days_off: closures };
      }
    }

    return previousHandler(req, res);
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.generalDaysOff = generalDaysOff;
module.exports.assertDateOpen = assertDateOpen;
