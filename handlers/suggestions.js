const { requireSession, db, assertDb, send, handleError, httpError } = require('../lib/server');
const { overlaps, calculateWeeklyMinutes, timeToMinutes } = require('../lib/schedule');

function sunday(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0,10);
}
function addDays(dateString,days){ const d=new Date(`${dateString}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function short(value){ return value ? String(value).slice(0,5) : null; }
function operationRange(operation, shift) {
  if (!shift) return { start:short(operation.start_time),end:short(operation.end_time) };
  if (['sick','absent'].includes(operation.operation_type)) return { start:short(shift.start_time),end:short(shift.end_time) };
  if (operation.operation_type === 'late') return { start:short(shift.start_time),end:short(operation.start_time||shift.end_time) };
  if (operation.operation_type === 'early_release') return { start:short(operation.end_time||shift.start_time),end:short(shift.end_time) };
  return { start:short(operation.start_time||shift.start_time),end:short(operation.end_time||shift.end_time) };
}
function level(score){ return score >= 85 ? 'high' : score >= 55 ? 'good' : 'possible'; }

module.exports = async function handler(req,res) {
  try {
    if (req.method !== 'GET') return send(res,405,{ ok:false,error:'Method not allowed' });
    await requireSession(req,{ manager:true,csrf:false });
    const date = String(req.query?.date || '');
    const classId = String(req.query?.class_id || '');
    const start = String(req.query?.start_time || '07:30').slice(0,5);
    const end = String(req.query?.end_time || '15:30').slice(0,5);
    const neededRole = String(req.query?.shift_role || 'staff');
    const excludeShiftId = String(req.query?.exclude_shift_id || '');
    if (!date || !classId) throw httpError(400,'חסרים תאריך או כיתה');
    if (timeToMinutes(end) <= timeToMinutes(start)) throw httpError(400,'טווח השעות אינו תקין');
    const weekStart = sunday(date);
    const weekEnd = addDays(weekStart,5);
    const [employeesR,shiftsR,requestsR,constraintsR,patternsR,operationsR,attendanceR] = await Promise.all([
      db().from('hadas_employees').select('*').eq('active',true).eq('is_schedulable',true),
      db().from('hadas_shifts').select('*').gte('shift_date',weekStart).lte('shift_date',weekEnd),
      db().from('hadas_requests').select('*').in('request_type',['leave','day_off','sick']).in('status',['approved','applied']).lte('request_date',date),
      db().from('hadas_employee_class_constraints').select('*').eq('class_id',classId),
      db().from('hadas_employee_weekly_patterns').select('*'),
      db().from('hadas_daily_operations').select('*').eq('operation_date',date),
      db().from('hadas_attendance').select('*').eq('attendance_date',date),
    ]);
    const employees = assertDb(employeesR,'לא ניתן לטעון עובדים') || [];
    const shifts = (assertDb(shiftsR,'לא ניתן לטעון שיבוצים') || []).filter((row)=>row.id!==excludeShiftId);
    const allWeekShifts = assertDb(shiftsR,'לא ניתן לטעון שיבוצים') || [];
    const requests = (assertDb(requestsR,'לא ניתן לטעון בקשות') || []).filter((row)=>date<=String(row.request_end_date||row.request_date));
    const constraints = assertDb(constraintsR,'לא ניתן לטעון אילוצים') || [];
    const weeklyPatterns = assertDb(patternsR,'לא ניתן לטעון ימי עבודה קבועים') || [];
    const operations = assertDb(operationsR,'לא ניתן לטעון תפעול יומי') || [];
    const attendance = assertDb(attendanceR,'לא ניתן לטעון נוכחות') || [];
    const shiftMap = new Map(allWeekShifts.map((row)=>[row.id,row]));
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();

    const candidates = [];
    for (const employee of employees) {
      const dayShifts = shifts.filter((shift) => shift.employee_id === employee.id && shift.shift_date === date);
      if (dayShifts.some((shift) => overlaps(start,end,shift.start_time,shift.end_time))) continue;
      if (requests.some((request) => request.requester_id === employee.id && request.request_date<=date && date<=String(request.request_end_date||request.request_date))) continue;
      const attendanceRow=attendance.find((row)=>row.employee_id===employee.id);
      if(attendanceRow&&['absent','sick'].includes(attendanceRow.status))continue;
      const operationallyUnavailable=operations.some((operation)=>{
        if(operation.employee_id!==employee.id)return false;
        const range=operationRange(operation,shiftMap.get(operation.shift_id));
        return range.start&&range.end&&overlaps(start,end,range.start,range.end);
      });
      if(operationallyUnavailable)continue;
      const constraint = constraints.find((item) => item.employee_id === employee.id && (!item.valid_from || item.valid_from <= date) && (!item.valid_to || item.valid_to >= date));
      if (constraint?.constraint_type === 'forbidden') continue;
      const pattern = weeklyPatterns.find((item) => item.employee_id === employee.id && Number(item.weekday) === day);
      if (pattern?.day_type === 'day_off' || (!pattern && employee.fixed_day_off === day)) continue;

      let score = 22;
      const reasons = [];
      if (!dayShifts.length) { score += 35; reasons.push('פנוי/ה בכל היום'); }
      else { score += 8; reasons.push('פנוי/ה בשעות שנבחרו'); }
      if (employee.primary_class_id === classId) { score += 34; reasons.push('הכיתה הקבועה שלו/ה'); }
      else if (employee.assignment_mode === 'substitute') { score += 32; reasons.push('משלימ/ת מקום'); }
      else if (employee.assignment_mode === 'rotation') { score += 22; reasons.push('ברוטציה בין כיתות'); }
      if (constraint?.constraint_type === 'preferred') { score += 24; reasons.push('עדיפות מפורשת לכיתה'); }
      if (constraint?.constraint_type === 'avoid') { score -= 28; reasons.push('עדיף להימנע מהכיתה'); }
      if (pattern?.day_type === 'as_needed') { score += 24; reasons.push('מוגדר/ת לפי צורך ביום זה'); }
      if (pattern?.day_type === 'work') {
        const sameHours = short(pattern.start_time) <= start && short(pattern.end_time) >= end;
        if (sameHours) { score += 16; reasons.push('השעות תואמות ליום העבודה הקבוע'); }
        else { score -= 18; reasons.push('השעות מחוץ למסגרת הקבועה'); }
      } else if (!pattern) reasons.push('אין מסגרת שעות קבועה ליום זה');
      const title = String(employee.job_title || '');
      if (neededRole === 'teacher') {
        if (/(גננת|גנן)/.test(title)) { score += 42; reasons.push('מתאים/ה כגננת/גנן'); }
        else if (employee.can_lead) { score += 20; reasons.push('יכול/ה לשמש מוביל/ה'); }
        else { score -= 45; reasons.push('לא מתאים/ה לתפקיד אחראי/ת כיתה'); }
      } else if (neededRole === 'lead') {
        if (employee.can_lead || /(גננת|גנן)/.test(title)) { score += 28; reasons.push('מורשה להוביל כיתה'); }
        else { score -= 35; reasons.push('אינו/ה מורשה להוביל כיתה'); }
      } else if (employee.can_lead) score += 5;
      const weeklyMinutes = calculateWeeklyMinutes(allWeekShifts.filter((row)=>row.id!==excludeShiftId),employee.id);
      const requestedMinutes = Math.max(0,timeToMinutes(end)-timeToMinutes(start));
      const maxMinutes = employee.max_weekly_hours == null ? null : Number(employee.max_weekly_hours)*60;
      if (maxMinutes != null && weeklyMinutes + requestedMinutes > maxMinutes) continue;
      const targetMinutes = employee.weekly_hours == null ? null : Number(employee.weekly_hours)*60;
      if (targetMinutes != null) {
        const gap = targetMinutes - weeklyMinutes;
        if (gap > 0) { score += Math.min(22,Math.round(gap/60)); reasons.push(`חסרות כ-${Math.round(gap/60)} שעות השבוע`); }
        else if (gap < -60) { score -= 14; reasons.push('כבר עבר/ה את היקף השעות המתוכנן'); }
      }
      let suggestedRole = neededRole;
      if (neededRole === 'teacher' && !/(גננת|גנן)/.test(title)) suggestedRole = employee.can_lead ? 'lead' : 'staff';
      if (neededRole === 'lead' && !(employee.can_lead || /(גננת|גנן)/.test(title))) suggestedRole='staff';
      candidates.push({
        employee_id:employee.id, full_name:employee.full_name, job_title:employee.job_title,
        score, recommendation_level:level(score), reasons, suggested_role:suggestedRole,
        weekly_hours:Number((weeklyMinutes/60).toFixed(1)), max_weekly_hours:employee.max_weekly_hours,
        current_day_shifts:dayShifts.map((shift) => ({ start_time:shift.start_time,end_time:shift.end_time,class_id:shift.class_id })),
      });
    }
    candidates.sort((a,b) => b.score-a.score || a.full_name.localeCompare(b.full_name,'he'));
    send(res,200,{ ok:true,candidates:candidates.slice(0,16) });
  } catch (error) { handleError(res,error); }
};
