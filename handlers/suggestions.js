const { requireSession, db, assertDb, send, handleError, httpError } = require('../lib/server');
const { overlaps, calculateWeeklyMinutes } = require('../lib/schedule');

function sunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0,10);
}
function addDays(dateString,days){ const d=new Date(`${dateString}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }

module.exports = async function handler(req,res) {
  try {
    if (req.method !== 'GET') return send(res,405,{ ok:false,error:'Method not allowed' });
    await requireSession(req,{ manager:true,csrf:false });
    const date = String(req.query?.date || '');
    const classId = String(req.query?.class_id || '');
    const start = String(req.query?.start_time || '07:30');
    const end = String(req.query?.end_time || '15:30');
    const neededRole = String(req.query?.shift_role || 'staff');
    if (!date || !classId) throw httpError(400,'חסרים תאריך או כיתה');
    const weekStart = sunday(date);
    const weekEnd = addDays(weekStart,5);
    const [employeesR,shiftsR,requestsR,constraintsR,patternsR] = await Promise.all([
      db().from('hadas_employees').select('*').eq('active',true).eq('is_schedulable',true),
      db().from('hadas_shifts').select('*').gte('shift_date',weekStart).lte('shift_date',weekEnd),
      db().from('hadas_requests').select('*').eq('request_date',date).in('status',['approved','applied','pending']),
      db().from('hadas_employee_class_constraints').select('*').eq('class_id',classId),
      db().from('hadas_employee_weekly_patterns').select('*'),
    ]);
    const employees = assertDb(employeesR,'לא ניתן לטעון עובדים') || [];
    const shifts = assertDb(shiftsR,'לא ניתן לטעון שיבוצים') || [];
    const requests = assertDb(requestsR,'לא ניתן לטעון בקשות') || [];
    const constraints = assertDb(constraintsR,'לא ניתן לטעון אילוצים') || [];
    const weeklyPatterns = assertDb(patternsR,'לא ניתן לטעון ימי עבודה קבועים') || [];
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();

    const candidates = [];
    for (const employee of employees) {
      const dayShifts = shifts.filter((shift) => shift.employee_id === employee.id && shift.shift_date === date);
      if (dayShifts.some((shift) => overlaps(start,end,shift.start_time,shift.end_time))) continue;
      if (requests.some((request) => request.requester_id === employee.id && ['leave','day_off','sick'].includes(request.request_type) && ['approved','applied'].includes(request.status))) continue;
      const constraint = constraints.find((item) => item.employee_id === employee.id && (!item.valid_from || item.valid_from <= date) && (!item.valid_to || item.valid_to >= date));
      if (constraint?.constraint_type === 'forbidden') continue;
      const pattern = weeklyPatterns.find((item) => item.employee_id === employee.id && Number(item.weekday) === day);
      if (pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off === day)) continue;

      let score = 0;
      const reasons = [];
      if (!dayShifts.length) { score += 40; reasons.push('אינה משובץ באותו יום'); }
      else { score += 5; reasons.push('פנויה בשעות החסרות'); }
      if (employee.primary_class_id === classId) { score += 28; reasons.push('זו הכיתה הקבועה שלו'); }
      else if (employee.assignment_mode === 'rotation') { score += 12; reasons.push('מוגדר ברוטציה בין כיתות'); }
      if (constraint?.constraint_type === 'preferred') { score += 18; reasons.push('מוגדרת בעדיפות לכיתה'); }
      if (constraint?.constraint_type === 'avoid') { score -= 25; reasons.push('עדיף להימנע משיבוץ בכיתה'); }
      if (pattern?.day_type === 'work') {
        const sameHours = String(pattern.start_time).slice(0,5) <= start && String(pattern.end_time).slice(0,5) >= end;
        if (sameHours) { score += 10; reasons.push('השעות תואמות ליום העבודה הקבוע'); }
        else { score -= 12; reasons.push('השעות שונות מהשעות הקבועות'); }
      }
      const title = String(employee.job_title || '');
      if (neededRole === 'teacher') {
        if (/(גננת|גנן)/.test(title)) { score += 35; reasons.push('גננת/גנן'); }
        else if (employee.can_lead) { score += 18; reasons.push('יכולה לשמש מוביל/ה'); }
        else { score -= 30; reasons.push('אינה מוגדרת כגננת/גנן או מוביל/ה'); }
      } else if (employee.can_lead) {
        score += 5;
      }
      const weeklyMinutes = calculateWeeklyMinutes(shifts,employee.id);
      const requestedMinutes = Math.max(0, Number(end.slice(0,2))*60 + Number(end.slice(3,5)) - (Number(start.slice(0,2))*60 + Number(start.slice(3,5))));
      const maxMinutes = employee.max_weekly_hours == null ? null : Number(employee.max_weekly_hours)*60;
      if (maxMinutes != null && weeklyMinutes + requestedMinutes > maxMinutes) continue;
      const targetMinutes = employee.weekly_hours == null ? null : Number(employee.weekly_hours)*60;
      if (targetMinutes != null) {
        const gap = targetMinutes - weeklyMinutes;
        if (gap > 0) { score += Math.min(20,Math.round(gap/60)); reasons.push(`חסרות לה כ-${Math.round(gap/60)} שעות השבוע`); }
        else if (gap < -60) { score -= 12; reasons.push('כבר עברה את היקף השעות השבועי'); }
      }
      let suggestedRole = neededRole;
      if (neededRole === 'teacher' && !/(גננת|גנן)/.test(title)) suggestedRole = employee.can_lead ? 'lead' : 'staff';
      candidates.push({
        employee_id:employee.id,
        full_name:employee.full_name,
        job_title:employee.job_title,
        score,
        reasons,
        suggested_role:suggestedRole,
        current_day_shifts:dayShifts.map((shift) => ({ start_time:shift.start_time,end_time:shift.end_time,class_id:shift.class_id })),
      });
    }
    candidates.sort((a,b) => b.score-a.score || a.full_name.localeCompare(b.full_name,'he'));
    send(res,200,{ ok:true,candidates:candidates.slice(0,12) });
  } catch (error) { handleError(res,error); }
};
