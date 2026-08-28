from pathlib import Path
import re, json

ROOT = Path.cwd()

def read(path):
    return (ROOT/path).read_text(encoding="utf-8")

def write(path, text):
    (ROOT/path).write_text(text, encoding="utf-8")

def exact(path, old, new, count=1):
    text = read(path)
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:120]!r}")
    text2 = text.replace(old, new, count)
    write(path, text2)

def regex(path, pattern, repl, count=1, flags=re.S):
    text=read(path)
    text2,n=re.subn(pattern,repl,text,count=count,flags=flags)
    if n != count:
        raise SystemExit(f"regex {path} expected {count}, got {n}: {pattern[:100]}")
    write(path,text2)

def append_once(path, marker, block):
    text=read(path)
    if marker in text:
        return
    write(path,text.rstrip()+"\n\n"+block.strip()+"\n")

# ---------- version / cache ----------
pkg=json.loads(read("package.json"))
pkg["version"]="0.22.0"
write("package.json", json.dumps(pkg, ensure_ascii=False, indent=2)+"\n")

exact("app.js","/* מערכת ניהול שיבוצים מעון הדס — גרסה 0.21.0 */","/* מערכת ניהול שיבוצים מעון הדס — גרסה 0.22.0 */")
exact("index.html",'href="/styles.css?v=0190"','href="/styles.css?v=0220"')
exact("index.html",'src="/app.js?v=0190"','src="/app.js?v=0220"')
exact("supabase/schema.sql","-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.21.0 (סכמת נתונים 0.21.0)","-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.22.0 (סכמת נתונים 0.22.0)")
exact("supabase/schema.sql","values (1, '0.21.0', '0.21.0')","values (1, '0.22.0', '0.22.0')")
exact("handlers/health.js","update-v0.21.0.sql","update-v0.22.0.sql")
exact("handlers/health.js","meta.data.schema_version === '0.21.0'","meta.data.schema_version === '0.22.0'")
exact("handlers/health.js","databaseVersion:'0.21.0'","databaseVersion:'0.22.0'")
for p in ["health.js"]:
    if (ROOT/p).exists():
        t=read(p).replace("0.21.0","0.22.0")
        write(p,t)

# ---------- DB schema ----------
exact("supabase/schema.sql",
"""  max_weekly_hours numeric(5,2) check (max_weekly_hours is null or (max_weekly_hours >= 0 and max_weekly_hours <= 80)),
  employment_percent numeric(5,2),""",
"""  max_weekly_hours numeric(5,2) check (max_weekly_hours is null or (max_weekly_hours >= 0 and max_weekly_hours <= 80)),
  max_work_days_per_week smallint check (max_work_days_per_week is null or max_work_days_per_week between 1 and 6),
  employment_percent numeric(5,2),""")
exact("supabase/schema.sql",
"""alter table public.hadas_employees add column if not exists max_weekly_hours numeric(5,2);
alter table public.hadas_employees add column if not exists employment_percent numeric(5,2);""",
"""alter table public.hadas_employees add column if not exists max_weekly_hours numeric(5,2);
alter table public.hadas_employees add column if not exists max_work_days_per_week smallint;
alter table public.hadas_employees add column if not exists employment_percent numeric(5,2);""")
exact("supabase/schema.sql",
"""  constraint_type text not null check (constraint_type in ('preferred','avoid','forbidden')),
  valid_from date,""",
"""  constraint_type text not null check (constraint_type in ('preferred','avoid','forbidden')),
  priority_rank smallint check (priority_rank is null or priority_rank between 1 and 20),
  valid_from date,""")

migration = """-- מערכת ניהול שיבוצים מעון הדס — גרסה 0.22.0
-- עדיפות כיתות מדורגת, מגבלת ימי עבודה למשלימי מקום ושדרוגי שיבוץ. ללא מחיקת שיבוצים או עובדים.

alter table public.hadas_employees
  add column if not exists max_work_days_per_week smallint;

alter table public.hadas_employees
  drop constraint if exists hadas_employees_max_work_days_per_week_check;
alter table public.hadas_employees
  add constraint hadas_employees_max_work_days_per_week_check
  check (max_work_days_per_week is null or max_work_days_per_week between 1 and 6);

alter table public.hadas_employee_class_constraints
  add column if not exists priority_rank smallint;

alter table public.hadas_employee_class_constraints
  drop constraint if exists hadas_employee_class_constraints_priority_rank_check;
alter table public.hadas_employee_class_constraints
  add constraint hadas_employee_class_constraints_priority_rank_check
  check (priority_rank is null or priority_rank between 1 and 20);

-- העדפות ישנות מקבלות דרגה רק אם לא הוגדרה להן דרגה. אין שינוי באיסורים קיימים.
with ranked as (
  select id,
         row_number() over (partition by employee_id order by created_at, id) + 1 as rn
  from public.hadas_employee_class_constraints
  where constraint_type='preferred' and priority_rank is null
)
update public.hadas_employee_class_constraints c
set priority_rank = least(20, ranked.rn::smallint)
from ranked
where c.id=ranked.id;

update public.hadas_employee_class_constraints
set priority_rank=null
where constraint_type in ('avoid','forbidden');

insert into public.hadas_app_meta(id,schema_version,app_version,updated_at)
values(1,'0.22.0','0.22.0',now())
on conflict(id) do update
set schema_version=excluded.schema_version,app_version=excluded.app_version,updated_at=now();
"""
write("supabase/update-v0.22.0.sql", migration)

# ---------- employees API ----------
exact("handlers/employees.js",
"const fields = ['full_name','job_title','primary_class_id','weekly_hours','max_weekly_hours','employment_percent','default_start','default_end','active','started_at','ended_at','assignment_mode'];",
"const fields = ['full_name','job_title','primary_class_id','weekly_hours','max_weekly_hours','max_work_days_per_week','employment_percent','default_start','default_end','active','started_at','ended_at','assignment_mode'];")
exact("handlers/employees.js",
"""  if (payload.max_weekly_hours !== undefined && payload.max_weekly_hours !== null) {
    payload.max_weekly_hours = Number(payload.max_weekly_hours);
    if (!Number.isFinite(payload.max_weekly_hours) || payload.max_weekly_hours < 0 || payload.max_weekly_hours > 80) throw httpError(400,'מקסימום השעות השבועיות אינו תקין');
  }""",
"""  if (payload.max_weekly_hours !== undefined && payload.max_weekly_hours !== null) {
    payload.max_weekly_hours = Number(payload.max_weekly_hours);
    if (!Number.isFinite(payload.max_weekly_hours) || payload.max_weekly_hours < 0 || payload.max_weekly_hours > 80) throw httpError(400,'מקסימום השעות השבועיות אינו תקין');
  }
  if (payload.max_work_days_per_week !== undefined && payload.max_work_days_per_week !== null) {
    payload.max_work_days_per_week = Number(payload.max_work_days_per_week);
    if (!Number.isInteger(payload.max_work_days_per_week) || payload.max_work_days_per_week < 1 || payload.max_work_days_per_week > 6) throw httpError(400,'מקסימום ימי העבודה השבועיים חייב להיות בין 1 ל-6');
  }""")
exact("handlers/employees.js",
"""  if (NON_SCHEDULABLE_TITLES.has(title)) {
    payload.assignment_mode = 'no_schedule';""",
"""  if ((payload.assignment_mode ?? body.assignment_mode ?? body.current_assignment_mode) !== 'substitute') payload.max_work_days_per_week = null;
  if (NON_SCHEDULABLE_TITLES.has(title)) {
    payload.assignment_mode = 'no_schedule';""")

regex("handlers/employees.js",
r"""async function replaceConstraints\(employeeId, constraints, actorId\) \{.*?\n\}\n\nasync function upsertPrivate""",
"""async function replaceConstraints(employeeId, constraints, actorId) {
  if (!Array.isArray(constraints)) return;
  const rows = constraints.filter((item) => item.class_id && ['preferred','avoid','forbidden'].includes(item.constraint_type)).map((item) => {
    const validFrom=item.valid_from || null, validTo=item.valid_to || null;
    if (validFrom && validTo && validTo < validFrom) throw httpError(400,'תאריך סיום האילוץ אינו יכול להיות לפני תאריך ההתחלה');
    const priorityRank = item.constraint_type === 'preferred' && item.priority_rank !== undefined && item.priority_rank !== null && item.priority_rank !== ''
      ? Number(item.priority_rank) : null;
    if (priorityRank !== null && (!Number.isInteger(priorityRank) || priorityRank < 1 || priorityRank > 20)) throw httpError(400,'סדר עדיפות הכיתה אינו תקין');
    return {
      employee_id:employeeId,
      class_id:item.class_id,
      constraint_type:item.constraint_type,
      priority_rank:priorityRank,
      valid_from:validFrom,
      valid_to:validTo,
      reason:String(item.reason || '').trim() || null,
      created_by:actorId,
    };
  });
  const duplicateKeys=new Set(); const ranks=new Set();
  for(const row of rows){
    const key=[row.class_id,row.constraint_type,row.valid_from||'',row.valid_to||''].join('|');
    if(duplicateKeys.has(key)) throw httpError(400,'קיים אילוץ כפול לאותה כיתה ותקופה');
    duplicateKeys.add(key);
    if(row.constraint_type==='preferred' && row.priority_rank!==null){
      if(ranks.has(row.priority_rank)) throw httpError(400,'יש לבחור סדר עדיפות שונה לכל כיתה');
      ranks.add(row.priority_rank);
    }
  }
  assertDb(await db().from('hadas_employee_class_constraints').delete().eq('employee_id',employeeId), 'לא ניתן לעדכן אילוצים');
  if (rows.length) assertDb(await db().from('hadas_employee_class_constraints').insert(rows), 'לא ניתן לשמור אילוצים');
  return rows;
}

async function upsertPrivate""")

# ---------- index: employee fields / shift / auto scope ----------
exact("index.html",
"""        <label><span class="field-title">מקסימום שעות שבועיות</span><input name="max_weekly_hours" type="number" inputmode="decimal" min="0" max="80" step="0.25" placeholder="לדוגמה 40" /></label>
        <label><span class="field-title">אחוז משרה</span>""",
"""        <label><span class="field-title">מקסימום שעות שבועיות</span><input name="max_weekly_hours" type="number" inputmode="decimal" min="0" max="80" step="0.25" placeholder="לדוגמה 40" /></label>
        <label id="maxWorkDaysField" class="hidden"><span class="field-title">מקסימום ימי עבודה בשבוע</span><select name="max_work_days_per_week"><option value="">ללא מגבלה</option><option value="1">1 יום</option><option value="2">2 ימים</option><option value="3">3 ימים</option><option value="4">4 ימים</option><option value="5">5 ימים</option><option value="6">6 ימים</option></select><small>למשל: זמינה בשלושה ימים, אבל בכל שבוע ניתן לשבץ אותה לכל היותר פעמיים.</small></label>
        <label><span class="field-title">אחוז משרה</span>""")
exact("index.html",
"""<details id="employeeConstraintsSection" class="employee-form-details"><summary><span class="section-number">5</span><span><strong>העדפות והגבלות כיתה</strong><small>מגדירים רק כאשר קיימת העדפה או מגבלה.</small></span>""",
"""<details id="employeeConstraintsSection" class="employee-form-details"><summary><span class="section-number">5</span><span><strong>עדיפות כיתות והגבלות</strong><small>הכיתה הקבועה תמיד ראשונה; מדרגים רק את שאר הכיתות.</small></span>""")

regex("index.html",
r"""        <section class="shift-recommendation-section full-field" aria-live="polite">.*?</section>\n        <section class="full-field shift-employee-picker" aria-labelledby="shiftEmployeePickerTitle">\n          <div class="employee-picker-title"><div><strong id="shiftEmployeePickerTitle">בחירת עובד</strong><small>.*?</small></div><span id="shiftEmployeeSelectedScore" class="selected-score-pill hidden"></span></div>""",
"""        <section class="full-field shift-employee-picker unified-shift-picker" aria-labelledby="shiftEmployeePickerTitle">
          <div class="employee-picker-title"><div><strong id="shiftEmployeePickerTitle">בחירת עובד / מחליף</strong><small>המומלצים מופיעים ראשונים באותה רשימה, יחד עם זמינות, התאמה וסיבת חסימה.</small></div><div class="picker-status-group"><span id="shiftRecommendationStatus" class="status-chip">מחשב התאמות</span><span id="shiftEmployeeSelectedScore" class="selected-score-pill hidden"></span></div></div>
          <div id="shiftRecommendations" class="hidden" aria-hidden="true"></div>""")
exact("index.html",
"""      <div class="modal-actions"><button type="button" class="ghost-btn close-dialog">ביטול</button><button class="primary-btn" value="default">שמירת השיבוץ</button></div>""",
"""      <div class="modal-actions shift-modal-actions"><button id="deleteShiftFromDialogBtn" type="button" class="danger-btn hidden">מחיקת השיבוץ</button><span class="modal-action-spacer"></span><button type="button" class="ghost-btn close-dialog">ביטול</button><button class="primary-btn" value="default">שמירת השיבוץ</button></div>""",1)

exact("index.html",
"""        <label class="auto-week-picker"><span>שבוע לשיבוץ</span><select id="autoScheduleWeek" name="auto_schedule_week"></select><small>בוחרים שבוע שלם באופן ישיר — בלי לבחור יום אקראי בתוך השבוע.</small></label>
        <div class="auto-mode-grid" role="radiogroup" aria-label="אופן יצירת השיבוץ">""",
"""        <label class="auto-week-picker"><span>שבוע לשיבוץ</span><select id="autoScheduleWeek" name="auto_schedule_week"></select><small>לאחר בחירת השבוע ניתן לבחור את כולו או רק ימים מסוימים.</small></label>
        <div class="auto-scope-grid" role="radiogroup" aria-label="היקף השיבוץ">
          <label class="auto-scope-card selected"><input type="radio" name="auto_schedule_scope" value="week" checked /><strong>כל השבוע</strong><small>ראשון–שישי</small></label>
          <label class="auto-scope-card"><input type="radio" name="auto_schedule_scope" value="partial" /><strong>חלק מהשבוע</strong><small>בחירת ימים ספציפיים</small></label>
        </div>
        <div id="autoScheduleDateChoices" class="auto-date-choices hidden" aria-label="בחירת ימים לשיבוץ"></div>
        <div class="auto-mode-grid" role="radiogroup" aria-label="אופן יצירת השיבוץ">""")

# ---------- app constraint UI ----------
regex("app.js",
r"""function renderConstraintFields\(employee = \{\}\) \{.*?\n\}\nfunction collectConstraints\(\) \{.*?\n\}""",
"""function renderConstraintFields(employee = {}) {
  const form=$('#employeeForm'); const target=$('#constraintsFields'); if(!form||!target)return;
  const existing=state.constraints.filter((constraint)=>constraint.employee_id===employee.id);
  const mode=form.elements.assignment_mode?.value || employee.assignment_mode || 'fixed';
  const primary=(mode==='fixed' ? (form.elements.primary_class_id?.value || employee.primary_class_id || '') : '');
  const activeClasses=state.classes.filter((item)=>item.active);
  const editable=activeClasses.filter((item)=>item.id!==primary);
  const rankStart=primary?2:1;
  const fixedClass=primary?classById(primary):null;
  const intro=fixedClass
    ? `<div class="class-priority-fixed"><span>★</span><div><strong>עדיפות 1 — ${escapeHtml(fixedClass.name)}</strong><small>הכיתה הקבועה מקבלת אוטומטית את העדיפות הגבוהה ביותר ואינה מופיעה שוב ברשימה.</small></div></div>`
    : `<div class="class-priority-fixed no-fixed"><span>↕</span><div><strong>ללא כיתה קבועה</strong><small>אפשר לקבוע סדר עדיפות בין כל הכיתות.</small></div></div>`;
  target.innerHTML=intro+editable.map((item,index)=>{
    const constraint=existing.find((row)=>row.class_id===item.id);
    const fallback=constraint?.constraint_type==='preferred' ? rankStart+index : 0;
    const currentRank=Number(constraint?.priority_rank||fallback||0);
    const rankOptions=editable.map((_,i)=>rankStart+i).map((rank)=>`<option value="rank:${rank}" ${currentRank===rank?'selected':''}>עדיפות ${rank}</option>`).join('');
    const selectedForbidden=constraint?.constraint_type==='forbidden';
    return `<div class="constraint-row compact-constraint class-priority-row" data-class-id="${item.id}"><label><span class="field-title">${escapeHtml(item.name)}</span><select class="constraint-priority"><option value="">ללא העדפה</option>${rankOptions}<option value="forbidden" ${selectedForbidden?'selected':''}>לא ניתן לשבץ</option></select></label><label class="constraint-reason-field">הסבר<input class="constraint-reason" value="${escapeHtml(constraint?.reason||'')}" placeholder="לא חובה"/></label></div>`;
  }).join('');
}
function collectConstraints() {
  return $$('.constraint-row').map((row)=>{
    const value=$('.constraint-priority',row)?.value||'';
    if(!value)return null;
    if(value==='forbidden')return {class_id:row.dataset.classId,constraint_type:'forbidden',priority_rank:null,valid_from:null,valid_to:null,reason:$('.constraint-reason',row)?.value||''};
    const rank=Number(value.replace('rank:',''));
    return {class_id:row.dataset.classId,constraint_type:'preferred',priority_rank:rank,valid_from:null,valid_to:null,reason:$('.constraint-reason',row)?.value||''};
  }).filter(Boolean);
}""")

exact("app.js",
"""  autoSchedulePreview: null,
  autoScheduleIssueDecisions: new Map(),""",
"""  autoSchedulePreview: null,
  autoScheduleIssueDecisions: new Map(),
  autoScheduleSelectedDates: [],""")

exact("app.js",
"""  $('#employeeConstraintsSection')?.classList.toggle('hidden', schedulingDisabled || managerTitle || teacher);
  const help=$('#assignmentModeHelp');""",
"""  $('#employeeConstraintsSection')?.classList.toggle('hidden', schedulingDisabled || managerTitle || teacher);
  const maxDaysField=$('#maxWorkDaysField'); if(maxDaysField) maxDaysField.classList.toggle('hidden', schedulingDisabled || assignment.value!=='substitute');
  if(assignment.value!=='substitute' && form.elements.max_work_days_per_week) form.elements.max_work_days_per_week.value='';
  const help=$('#assignmentModeHelp');""")
exact("app.js",
"""  if(help) help.textContent=assignment.value==='fixed'?'כיתה קבועה ולאחר מכן בחירת הכיתה.':assignment.value==='rotation'?'עובר/ת בין כיתות לפי הרוטציה והעדפות הכיתה.':'משלימ/ת מקום ללא כיתה קבועה; ניתן לסמן ימים לפי צורך או ימים שעדיף להימנע מהם.';""",
"""  if(help) help.textContent=assignment.value==='fixed'?'כיתה קבועה ולאחר מכן סדר עדיפות לשאר הכיתות.':assignment.value==='rotation'?'עובר/ת בין כיתות לפי סדר העדיפות שהוגדר.':'משלימ/ת מקום: מסמנים באילו ימים זמינה ובמידת הצורך גם מגבלת מספר ימי עבודה בשבוע.';""")
exact("app.js",
"""  if (!schedulingDisabled) renderWeeklyPatternFields({ assignment_mode: assignment.value, default_start: form.elements.default_start.value, default_end: form.elements.default_end.value, weekly_patterns: patternsBefore });
}""",
"""  if (!schedulingDisabled) renderWeeklyPatternFields({ assignment_mode: assignment.value, default_start: form.elements.default_start.value, default_end: form.elements.default_end.value, weekly_patterns: patternsBefore });
  if(!schedulingDisabled && !managerTitle && !teacher) renderConstraintFields(employeeById(form.elements.id.value)||{id:form.elements.id.value,primary_class_id:form.elements.primary_class_id.value,assignment_mode:assignment.value});
}""")
exact("app.js",
"""  form.elements.max_weekly_hours.value = employee.max_weekly_hours ?? '';
  form.elements.employment_percent.value = employee.employment_percent ?? '';""",
"""  form.elements.max_weekly_hours.value = employee.max_weekly_hours ?? '';
  form.elements.max_work_days_per_week.value = employee.max_work_days_per_week ?? '';
  form.elements.employment_percent.value = employee.employment_percent ?? '';""")

exact("app.js",
"""  $('#employeeForm [name="assignment_mode"]').addEventListener('change', syncEmployeeAssignmentFields);
  $('.employee-form-nav', $('#employeeForm')).addEventListener('click', handleEmployeeFormNav);""",
"""  $('#employeeForm [name="assignment_mode"]').addEventListener('change', syncEmployeeAssignmentFields);
  $('#employeeForm [name="primary_class_id"]').addEventListener('change', () => renderConstraintFields(employeeById($('#employeeForm').elements.id.value)||{}));
  $('.employee-form-nav', $('#employeeForm')).addEventListener('click', handleEmployeeFormNav);""")

# ---------- shift editing ----------
exact("app.js",
"""  const initialEmployee = shift.employee_id || "";
  state.shiftPickerCandidates = [];""",
"""  const initialEmployee = shift.employee_id || "";
  form.dataset.originalEmployeeId=initialEmployee;
  state.shiftPickerCandidates = [];""")
exact("app.js",
"""  $("#shiftDialog").showModal(); queueShiftRecommendations();""",
"""  const deleteButton=$('#deleteShiftFromDialogBtn'); if(deleteButton) deleteButton.classList.toggle('hidden',!shift.id);
  $("#shiftDialog").showModal(); queueShiftRecommendations();""")

exact("app.js",
"""  form.elements.employee_id.value = button.dataset.pickerEmployee;
  form.elements.override_rules.value='false'; form.elements.override_reason.value='';
  if (button.dataset.pickerRole && form.dataset.roleTouched !== 'true') form.elements.shift_role.value = button.dataset.pickerRole;
  renderShiftEmployeePicker(); syncShiftHoursFromPattern(); syncShiftRoleFromEmployee(true); updateShiftEmployeeHint();""",
"""  const nextEmployeeId=button.dataset.pickerEmployee;
  const preserveExistingHours=Boolean(form.elements.id.value) && nextEmployeeId===form.dataset.originalEmployeeId;
  form.elements.employee_id.value = nextEmployeeId;
  form.elements.override_rules.value='false'; form.elements.override_reason.value='';
  if (button.dataset.pickerRole && form.dataset.roleTouched !== 'true') form.elements.shift_role.value = button.dataset.pickerRole;
  renderShiftEmployeePicker(); if(!preserveExistingHours) syncShiftHoursFromPattern(); syncShiftRoleFromEmployee(true); updateShiftEmployeeHint();""")

regex("app.js",
r"""function renderShiftRecommendations\(candidates = \[\]\) \{.*?\n\}""",
"""function renderShiftRecommendations(candidates = []) {
  const target=$("#shiftRecommendations"),status=$("#shiftRecommendationStatus");
  if(target){target.innerHTML='';target.classList.add('hidden');}
  const recommended=candidates.filter((item)=>item.recommended!==false&&normalizeDisplayScore(item.score)>=62);
  if(!candidates.length){status.textContent='אין עובדים זמינים';status.className='status-chip warn';return;}
  status.textContent=recommended.length?`${recommended.length} מומלצים · ${candidates.length} זמינים`:`${candidates.length} אפשרויות`;
  status.className=`status-chip ${recommended.length?'ok':'warn'}`;
}""")

insert_marker="async function handleScheduleClick(event) {"
delete_fn="""async function deleteShiftFromDialog() {
  const form=$('#shiftForm'); const id=form?.elements.id.value; if(!id)return;
  const shift=state.shifts.find((row)=>row.id===id); if(!shift)return;
  if(!confirm(`למחוק את השיבוץ של ${employeeById(shift.employee_id)?.full_name||'העובד'}? השינוי ימתין לפרסום.`))return;
  const button=$('#deleteShiftFromDialogBtn'); setBusy(button,true,'מוחק…');
  try{
    await apiFetch('/api/shifts',{method:'DELETE',body:{id}});
    $('#shiftDialog').close(); state.shiftSuggestionCache.clear(); await refreshScheduleWeek({force:true});
    showToast('השיבוץ הוסר מהטיוטה','success');
  }catch(error){showToast(error.message,'error');}
  finally{setBusy(button,false);}
}

"""
exact("app.js",insert_marker,delete_fn+insert_marker)
exact("app.js",
"""  $('#shiftEmployeeOptionsList').addEventListener('click', handleShiftEmployeePickerClick);
  $('#shiftForm [name="shift_date"]').addEventListener('change', () => { syncShiftHoursFromPattern(); queueShiftRecommendations(); });""",
"""  $('#shiftEmployeeOptionsList').addEventListener('click', handleShiftEmployeePickerClick);
  $('#deleteShiftFromDialogBtn').addEventListener('click', deleteShiftFromDialog);
  $('#shiftForm [name="shift_date"]').addEventListener('change', () => { syncShiftHoursFromPattern(); queueShiftRecommendations(); });""")

# schedule cards / table
regex("app.js",
r"""function shiftCardHtml\(shift, compact = false\) \{.*?\n\}""",
"""function shiftCardHtml(shift, compact = false) {
  const employee=employeeById(shift.employee_id);
  const roleClass=`role-${shift.shift_role||'staff'}`;
  return `<article class="shift-item ${roleClass} ${shift.status==='draft'?'is-draft':''} ${compact?'shift-card':''} ${isManager()?'is-editable':''}" data-shift-id="${shift.id}" ${isManager()?`data-action="edit" data-id="${shift.id}" role="button" tabindex="0" aria-label="עריכת השיבוץ של ${escapeHtml(employee?.full_name||'עובד')}"`:''}><div class="shift-main"><strong>${escapeHtml(employee?.full_name||'עובד')}</strong><span class="shift-time">${timeHtml(shift.start_time,shift.end_time)}</span><small>${SHIFT_ROLE_LABELS[shift.shift_role]}${shift.public_note?` · ${escapeHtml(shift.public_note)}`:''}</small></div>${isManager()?'<span class="shift-edit-hint" aria-hidden="true">✎</span>':''}</article>`;
}""")
exact("app.js",
"""<div class="cell-footer manager-only ${isManager() ? '' : 'hidden'}"><button class="mini-btn cell-action" data-action="add" data-date="${iso}" data-class="${classItem.id}">＋ הוספה</button><button class="mini-btn cell-action" data-action="suggest-empty" data-date="${iso}" data-class="${classItem.id}">הצעת מחליף/ה</button></div>""",
"""<div class="cell-footer manager-only ${isManager() ? '' : 'hidden'}"><button class="mini-btn cell-action" data-action="add" data-date="${iso}" data-class="${classItem.id}">＋ הוספת שיבוץ</button></div>""")

# publication state + moving button
regex("app.js",
r"""function renderPublicationState\(\) \{.*?\n\}\nfunction shiftCardHtml""",
"""function renderPublicationState() {
  const drafts=state.shifts.filter((shift)=>shift.status==='draft').length;
  const published=state.publication?.published_at;
  const button=$('#publishScheduleBtn');
  if(button){
    const clean=Boolean(published)&&drafts===0;
    button.classList.add('publication-toggle'); button.classList.toggle('is-published',clean); button.classList.toggle('has-drafts',drafts>0);
    button.innerHTML=clean?'<span class="publication-toggle-dot"></span><span>מפורסם</span>':`<span class="publication-toggle-dot"></span><span>${published?'שינויים לא פורסמו':'לא פורסם'}</span>`;
  }
  const text=drafts
    ? `<div class="publication-banner compact draft"><div><strong>${drafts} שינויים ממתינים לפרסום</strong><small>הצוות ממשיך לראות את הגרסה האחרונה שפורסמה.</small></div></div>`
    : published
      ? `<div class="publication-banner compact published"><div><strong>השבוע מפורסם</strong><small>גרסה ${state.publication.revision||1} · ${formatDate(published,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</small></div></div>`
      : '<div class="publication-banner compact"><div><strong>השבוע טרם פורסם</strong><small>פרסום מתבצע מהכפתור למעלה.</small></div></div>';
  $('#schedulePublicationState').innerHTML=text;
}
function shiftCardHtml""")

# absence rendering
exact("app.js",
"""function absenceLabel(type) { return type === 'leave' ? 'חופשה' : type === 'day_off' ? 'יום חופשי' : type === 'sick' ? 'מחלה' : 'היעדרות'; }""",
"""function absenceLabel(type) { return type === 'leave' ? 'חופשה חד-פעמית' : type === 'day_off' ? 'יום חופשי חד-פעמי' : type === 'sick' ? 'מחלה' : type === 'day_off_worked' ? 'הגיע/ה ביום חופשי קבוע' : 'היעדרות'; }""")
exact("app.js",
"""return `<article class="absence-day-card ${rows.length ? 'has-absences' : ''}"><div class="absence-day-heading"><div><strong>${DAY_NAMES[parseDateValue(iso).getDay()]}</strong><span>${formatDate(iso, { day: '2-digit', month: '2-digit' })}</span></div><span class="absence-count">${rows.length}</span></div><div class="absence-people">${rows.length ? rows.map((item) => `<div class="absence-person type-${item.absence_type}"><span class="absence-icon">${absenceIcon(item.absence_type)}</span><span><strong>${escapeHtml(employeeById(item.employee_id)?.full_name || item.employee_name || 'עובד')}</strong><small>${absenceLabel(item.absence_type)}${fixedClassLabel(item.employee_id)?` · כיתה קבועה: ${escapeHtml(fixedClassLabel(item.employee_id))}`:''}</small></span></div>`).join('') : '<span class="absence-empty">אין חופשות או היעדרויות</span>'}</div></article>`;""",
"""return `<article class="absence-day-card ${rows.length ? 'has-absences' : ''}"><div class="absence-day-heading"><div><strong>${DAY_NAMES[parseDateValue(iso).getDay()]}</strong><span>${formatDate(iso, { day: '2-digit', month: '2-digit' })}</span></div><span class="absence-count">${rows.length}</span></div><div class="absence-people">${rows.length ? rows.map((item) => `<div class="absence-person type-${item.absence_type} ${item.absence_type==='day_off_worked'?'worked-day-off':'one-time-absence'}"><span class="absence-icon">${item.absence_type==='day_off_worked'?'✓':absenceIcon(item.absence_type)}</span><span><strong>${escapeHtml(employeeById(item.employee_id)?.full_name || item.employee_name || 'עובד')}</strong><small>${absenceLabel(item.absence_type)}${fixedClassLabel(item.employee_id)?` · כיתה קבועה: ${escapeHtml(fixedClassLabel(item.employee_id))}`:''}</small></span></div>`).join('') : '<span class="absence-empty">אין חופשות, מחלות או הגעה חריגה ביום חופשי</span>'}</div></article>`;""")

# ---------- auto schedule scope UI ----------
exact("app.js",
"""function autoSelectedWeekStart() {
  const input = $('#autoScheduleWeek');
  return input?.value ? parseDateValue(input.value) : startOfWeek(state.weekStart);
}
function autoPreviewDates""",
"""function autoSelectedWeekStart() {
  const input = $('#autoScheduleWeek');
  return input?.value ? parseDateValue(input.value) : startOfWeek(state.weekStart);
}
function renderAutoScheduleDateChoices() {
  const target=$('#autoScheduleDateChoices'); if(!target)return;
  const start=autoSelectedWeekStart(); const scope=$('#autoScheduleDialog input[name="auto_schedule_scope"]:checked')?.value||'week';
  const dates=Array.from({length:6},(_,index)=>addDays(start,index));
  if(scope==='week'){state.autoScheduleSelectedDates=dates.map(dateISO);target.classList.add('hidden');target.innerHTML='';return;}
  target.classList.remove('hidden');
  const previous=new Set(state.autoScheduleSelectedDates);
  target.innerHTML=dates.map((date,index)=>{const iso=dateISO(date),checked=previous.size?previous.has(iso):true;return `<label class="auto-date-chip ${checked?'selected':''}"><input type="checkbox" value="${iso}" ${checked?'checked':''}/><strong>${DAY_NAMES[date.getDay()]}</strong><small>${formatDate(date,{day:'2-digit',month:'2-digit'})}</small></label>`;}).join('');
  state.autoScheduleSelectedDates=$$('#autoScheduleDateChoices input:checked').map((input)=>input.value);
}
function autoSelectedDates() {
  const scope=$('#autoScheduleDialog input[name="auto_schedule_scope"]:checked')?.value||'week';
  if(scope==='week')return Array.from({length:6},(_,index)=>dateISO(addDays(autoSelectedWeekStart(),index)));
  return $$('#autoScheduleDateChoices input:checked').map((input)=>input.value);
}
function autoPreviewDates""")

exact("app.js",
"""  const rebuild = $('#autoScheduleDialog input[value="rebuild"]'); if (rebuild) rebuild.checked = true;
  populateAutoScheduleWeeks();
  syncAutoScheduleModeCards();""",
"""  const rebuild = $('#autoScheduleDialog input[value="rebuild"]'); if (rebuild) rebuild.checked = true;
  const fullScope=$('#autoScheduleDialog input[name="auto_schedule_scope"][value="week"]'); if(fullScope) fullScope.checked=true;
  populateAutoScheduleWeeks(); renderAutoScheduleDateChoices();
  syncAutoScheduleModeCards();""")

insert="function autoIssueCardHtml(item) {"
presence="""function autoIssuePresenceHtml(item,preview=state.autoSchedulePreview) {
  if(!item?.date||!item?.class_id)return '';
  const start=trimTime(item.time||item.start_time||item.start||state.settings.opening_time||'07:30');
  const end=trimTime(item.end_time||item.end||closingTimeForDate(item.date));
  const rows=sortScheduleRows((preview?.finalRows||[]).filter((row)=>row.shift_date===item.date&&row.class_id===item.class_id&&overlaps(row.start_time,row.end_time,start,end)));
  const title=rows.length?`מי נמצא כרגע (${rows.length})`:'מי נמצא כרגע (אין עובדים בטווח)';
  return `<details class="auto-issue-presence"><summary>${title}</summary><div>${rows.length?rows.map((row)=>`<span><strong>${escapeHtml(employeeById(row.employee_id)?.full_name||'עובד')}</strong><small>${timeHtml(row.start_time,row.end_time)}</small></span>`).join(''):'<small>אין שיבוץ פעיל בכיתה בשעות האלו.</small>'}</div></details>`;
}
"""
exact("app.js",insert,presence+insert)
exact("app.js",
"""</div></div><div class="auto-issue-actions"><button type="button" data-auto-issue-action="fix">תיקון</button>""",
"""</div></div>${autoIssuePresenceHtml(item)}<div class="auto-issue-actions"><button type="button" data-auto-issue-action="fix">תיקון</button>""")

exact("app.js",
"""  const weekStart=autoSelectedWeekStart();
  state.autoScheduleIssueDecisions=new Map();""",
"""  const weekStart=autoSelectedWeekStart(); const selectedDates=autoSelectedDates();
  if(!selectedDates.length){showToast('יש לבחור לפחות יום אחד לשיבוץ','error');return;}
  state.autoScheduleSelectedDates=selectedDates;
  state.autoScheduleIssueDecisions=new Map();""")
exact("app.js",
"""body:{action:'auto_preview',week_start:dateISO(weekStart),mode}""",
"""body:{action:'auto_preview',week_start:dateISO(weekStart),mode,selected_dates:selectedDates}""")
exact("app.js",
"""body:{action:'auto_apply',week_start:preview.weekStart,mode:preview.mode,signature:preview.signature,allow_incomplete:errors.length>0}""",
"""body:{action:'auto_apply',week_start:preview.weekStart,mode:preview.mode,selected_dates:preview.selectedDates||state.autoScheduleSelectedDates,signature:preview.signature,allow_incomplete:errors.length>0}""")

exact("app.js",
"""<p>שבוע ${formatDate(start)}–${formatDate(addDays(start,5))} · נוצרו ${metrics.generatedCount||0} שיבוצים. שום שינוי עדיין לא נשמר.</p>""",
"""<p>${(preview.selectedDates||[]).length===6?`שבוע ${formatDate(start)}–${formatDate(addDays(start,5))}`:`${(preview.selectedDates||[]).length} ימים שנבחרו`} · נוצרו ${metrics.generatedCount||0} שיבוצים. שום שינוי עדיין לא נשמר.</p>""")

exact("app.js",
"""  $('#autoScheduleWeek')?.addEventListener('change', () => {});
  $('#autoSchedulePreview').addEventListener('click', handleAutoSchedulePreviewClick);""",
"""  $('#autoScheduleWeek')?.addEventListener('change', renderAutoScheduleDateChoices);
  $$('#autoScheduleDialog input[name="auto_schedule_scope"]').forEach((input)=>input.addEventListener('change',()=>{$$('.auto-scope-card').forEach((card)=>card.classList.toggle('selected',Boolean(card.querySelector('input:checked'))));renderAutoScheduleDateChoices();}));
  $('#autoScheduleDateChoices')?.addEventListener('change',()=>{$$('.auto-date-chip').forEach((chip)=>chip.classList.toggle('selected',Boolean(chip.querySelector('input:checked'))));state.autoScheduleSelectedDates=autoSelectedDates();});
  $('#autoSchedulePreview').addEventListener('click', handleAutoSchedulePreviewClick);""")

# ---------- matching priorities ----------
exact("lib/matching.js",
"""  if (constraint?.constraint_type === 'preferred') { score += 15; reasons.push('עדיפות מפורשת לכיתה'); }
  if (constraint?.constraint_type === 'avoid') { score -= 28; cautions.push('הוגדר שעדיף להימנע מהכיתה'); }""",
"""  if (constraint?.constraint_type === 'preferred') {
    const rank=Number(constraint.priority_rank); const bonus=Number.isInteger(rank)&&rank>0?Math.max(-8,28-(rank-1)*8):15;
    score += bonus; reasons.push(Number.isInteger(rank)&&rank>0?`עדיפות כיתה ${rank}`:'עדיפות מפורשת לכיתה');
  }
  if (constraint?.constraint_type === 'avoid') { score -= 28; cautions.push('הוגדר שעדיף להימנע מהכיתה'); }""")

# ---------- auto engine priorities / selected dates / max days ----------
exact("lib/auto-schedule.js",
"""  if (constraint?.constraint_type === 'preferred') { score += 38; reasons.push('העדפה מפורשת לכיתה'); }
  if (constraint?.constraint_type === 'avoid') { score -= 38; reasons.push('עדיף להימנע מהכיתה'); }""",
"""  if (constraint?.constraint_type === 'preferred') {
    const rank=Number(constraint.priority_rank); const bonus=Number.isInteger(rank)&&rank>0?Math.max(-12,52-(rank-1)*14):38;
    score += bonus; reasons.push(Number.isInteger(rank)&&rank>0?`עדיפות כיתה ${rank}`:'העדפה מפורשת לכיתה');
  }
  if (constraint?.constraint_type === 'avoid') { score -= 38; reasons.push('עדיף להימנע מהכיתה'); }""")
exact("lib/auto-schedule.js",
"""    settings = {}, existingShifts = [], previousShifts = [], mode = 'rebuild', createdBy = null,
  } = input;
  const dates = dateRange(weekStart, 6);""",
"""    settings = {}, existingShifts = [], previousShifts = [], mode = 'rebuild', createdBy = null, selectedDates = null,
  } = input;
  const weekDates=dateRange(weekStart,6);
  const selectedSet=new Set(Array.isArray(selectedDates)&&selectedDates.length?selectedDates:weekDates);
  const dates=weekDates.filter((date)=>selectedSet.has(date));""")
exact("lib/auto-schedule.js",
"""  const kept = mode === 'fill' ? existingShifts.map((row) => ({ ...row })) : [];""",
"""  const kept = mode === 'fill' ? existingShifts.map((row) => ({ ...row })) : existingShifts.filter((row)=>!selectedSet.has(row.shift_date)).map((row)=>({...row}));""")
exact("lib/auto-schedule.js",
"""  function remainingFor(employee) { return Math.max(0, maxMinutes(employee) - (weeklyMinutes.get(employee.id) || 0)); }
  function employeeDayRows""",
"""  function remainingFor(employee) { return Math.max(0, maxMinutes(employee) - (weeklyMinutes.get(employee.id) || 0)); }
  function workDayLimitReached(employee,date) {
    const limit=Number(employee.max_work_days_per_week); if(!Number.isInteger(limit)||limit<1)return false;
    const employeeRows=allRows.filter((row)=>row.employee_id===employee.id);
    if(employeeRows.some((row)=>row.shift_date===date))return false;
    return new Set(employeeRows.map((row)=>row.shift_date)).size>=limit;
  }
  function employeeDayRows""")
exact("lib/auto-schedule.js",
"""    const duration = timeToMinutes(end) - timeToMinutes(start);
    if (duration <= 0 || duration > remainingFor(employee)) return null;""",
"""    const duration = timeToMinutes(end) - timeToMinutes(start);
    if (duration <= 0 || duration > remainingFor(employee) || workDayLimitReached(employee,date)) return null;""")
exact("lib/auto-schedule.js",
"""  const validation = validateWeek({ shifts: finalRows, classes, employees, settings, constraints, weeklyPatterns: patterns, requests, weekStart });

  // A fixed work day""",
"""  const validation = validateWeek({ shifts: finalRows, classes, employees, settings, constraints, weeklyPatterns: patterns, requests, weekStart });
  if(dates.length<weekDates.length){
    validation.errors=validation.errors.filter((item)=>!item.date||selectedSet.has(item.date));
    validation.warnings=validation.warnings.filter((item)=>!item.date||selectedSet.has(item.date));
  }
  const shortNonFixed=generated.filter((row)=>row._kind==='as_needed').flatMap((row)=>{
    const employee=activeEmployees.find((item)=>item.id===row.employee_id);
    const availability=employee&&employeeAvailability({employee,date:row.shift_date,patterns,requests,settings});
    if(!availability)return [];
    if(shortTime(row.start_time)===shortTime(availability.start)&&shortTime(row.end_time)===shortTime(availability.end))return [];
    return [{code:'short_nonfixed_shift',date:row.shift_date,class_id:row.class_id,employee_id:row.employee_id,start_time:shortTime(row.start_time),end_time:shortTime(row.end_time),message:`${employee.full_name}: מוצעת משמרת קצרה ${shortTime(row.start_time)}–${shortTime(row.end_time)} ביום שאינו שעות עבודה קבועות — נדרש אישור`}];
  });
  validation.errors.push(...shortNonFixed);

  // A fixed work day""")
exact("lib/auto-schedule.js",
"""    weekStart, mode, generated: cleanGenerated, finalRows, keptCount: kept.length,""",
"""    weekStart, selectedDates:dates, mode, generated: cleanGenerated, finalRows, keptCount: kept.length,""")
exact("lib/auto-schedule.js",
"""    signature: shiftSignature(finalRows),""",
"""    signature: crypto.createHash('sha256').update(`${dates.join(',')}|${mode}|${shiftSignature(finalRows)}`).digest('hex').slice(0,24),""")

# ---------- schedule validator max work days ----------
exact("lib/schedule.js",
"""    const weeklyMinutes = calculateWeeklyMinutes(shifts, employee.id);
    const maximumValue = Number(employee.max_weekly_hours);""",
"""    const weeklyMinutes = calculateWeeklyMinutes(shifts, employee.id);
    const workDays=new Set(employeeShifts.map((shift)=>shift.shift_date));
    const dayLimit=Number(employee.max_work_days_per_week);
    if(Number.isInteger(dayLimit)&&dayLimit>0&&workDays.size>dayLimit){
      const hasOverride=employeeShifts.some((shift)=>shift.rule_override);
      const item={code:'max_weekly_days',employee_id:employee.id,message:`${employee.full_name}: שובץ ${workDays.size} ימים ועבר את המקסימום השבועי ${dayLimit}`};
      (hasOverride?warnings:errors).push(item);
    }
    const maximumValue = Number(employee.max_weekly_hours);""")

# ---------- shifts handler selected dates + manual cap ----------
exact("handlers/shifts.js",
"""function shiftSnapshot(shift) {""",
"""function selectedDatesForWeek(weekStart,input) {
  const allowed=new Set(Array.from({length:6},(_,index)=>addDays(weekStart,index)));
  if(input===undefined||input===null)return [...allowed];
  if(!Array.isArray(input))throw httpError(400,'רשימת הימים לשיבוץ אינה תקינה');
  const rows=[...new Set(input.map(String).filter((date)=>allowed.has(date)))].sort();
  if(!rows.length)throw httpError(400,'יש לבחור לפחות יום אחד לשיבוץ האוטומטי');
  return rows;
}

function shiftSnapshot(shift) {""")

exact("handlers/shifts.js",
"""  const overlaps = assertDb(await existingQuery, 'בדיקת חפיפה נכשלה') || []; if (overlaps.length) throw httpError(409, 'העובד כבר משובץ בשעות חופפות');

  if (!overrideRules) {""",
"""  const overlaps = assertDb(await existingQuery, 'בדיקת חפיפה נכשלה') || []; if (overlaps.length) throw httpError(409, 'העובד כבר משובץ בשעות חופפות');

  if (!overrideRules && Number.isInteger(Number(employee.max_work_days_per_week)) && Number(employee.max_work_days_per_week)>0) {
    const weekStart=getSunday(payload.shift_date),weekEnd=addDays(weekStart,5);
    const weekRows=assertDb(await db().from('hadas_shifts').select('id,shift_date').eq('employee_id',payload.employee_id).gte('shift_date',weekStart).lte('shift_date',weekEnd),'בדיקת מספר ימי העבודה נכשלה')||[];
    const relevant=weekRows.filter((row)=>!id||row.id!==id); const dates=new Set(relevant.map((row)=>row.shift_date));
    if(!dates.has(payload.shift_date)&&dates.size>=Number(employee.max_work_days_per_week)) throw httpError(409,`לעובד הוגדר מקסימום ${employee.max_work_days_per_week} ימי עבודה בשבוע. ניתן לשמור רק כשיבוץ ידני חריג.`);
  }

  if (!overrideRules) {""")

exact("handlers/shifts.js",
"""    weekStart: plan.weekStart,
    mode: plan.mode,""",
"""    weekStart: plan.weekStart,
    selectedDates: plan.selectedDates || [],
    mode: plan.mode,""")

exact("handlers/shifts.js",
"""      const mode = body.mode === 'fill' ? 'fill' : 'rebuild';
      const data = await loadAutomaticScheduleData(weekStart);
      const plan = generateAutomaticSchedule({ ...data, weekStart, mode, createdBy: caller.employee.id });""",
"""      const mode = body.mode === 'fill' ? 'fill' : 'rebuild';
      const selectedDates=selectedDatesForWeek(weekStart,body.selected_dates);
      const data = await loadAutomaticScheduleData(weekStart);
      const plan = generateAutomaticSchedule({ ...data, weekStart, mode, selectedDates, createdBy: caller.employee.id });""",2)

exact("handlers/shifts.js",
"""      const weekEnd = addDays(weekStart, 5);
      const deletedRows = mode === 'rebuild' ? data.existingShifts : [];
      const rows = plan.generated.map((row) => ({ ...row, status: 'draft', created_by: caller.employee.id }));
      let inserted = [];
      try {
        if (deletedRows.length) assertDb(await db().from('hadas_shifts').delete().gte('shift_date', weekStart).lte('shift_date', weekEnd), 'לא ניתן לנקות את השבוע לפני השיבוץ האוטומטי');""",
"""      const deletedRows = mode === 'rebuild' ? data.existingShifts.filter((row)=>selectedDates.includes(row.shift_date)) : [];
      const rows = plan.generated.map((row) => ({ ...row, status: 'draft', created_by: caller.employee.id }));
      let inserted = [];
      try {
        if (deletedRows.length) assertDb(await db().from('hadas_shifts').delete().in('shift_date', selectedDates), 'לא ניתן לנקות את הימים שנבחרו לפני השיבוץ האוטומטי');""")
exact("handlers/shifts.js",
"""        mode, generated: inserted.length, quality: plan.metrics.quality,""",
"""        mode, selected_dates:selectedDates, generated: inserted.length, quality: plan.metrics.quality,""")

# ---------- absences server ----------
regex("handlers/shifts.js",
r"""function buildScheduleAbsences\(requests, employees, weeklyPatterns, weekStart\) \{.*?\n\}\n""",
"""function buildScheduleAbsences(requests, employees, weeklyPatterns, shifts, weekStart) {
  const dates=Array.from({length:6},(_,index)=>addDays(weekStart,index));
  const absenceMap=new Map();
  for(const request of requests){
    if(!['approved','applied'].includes(request.status)||!['leave','day_off','sick'].includes(request.request_type))continue;
    const endDate=request.request_end_date||request.request_date;
    for(const cursor of dates){
      if(cursor<request.request_date||cursor>endDate)continue;
      absenceMap.set(`${request.requester_id}:${cursor}`,{employee_id:request.requester_id,absence_date:cursor,absence_type:request.request_type,absence_kind:'one_time_absence'});
    }
  }
  const employeesWithPatterns=new Set(weeklyPatterns.map((row)=>row.employee_id));
  for(const pattern of weeklyPatterns.filter((row)=>row.day_type==='day_off')){
    for(const date of dates){
      if(new Date(`${date}T12:00:00Z`).getUTCDay()!==Number(pattern.weekday))continue;
      if(!shifts.some((shift)=>shift.employee_id===pattern.employee_id&&shift.shift_date===date))continue;
      const key=`${pattern.employee_id}:${date}`;
      if(!absenceMap.has(key))absenceMap.set(key,{employee_id:pattern.employee_id,absence_date:date,absence_type:'day_off_worked',absence_kind:'worked_day_off'});
    }
  }
  for(const employee of employees.filter((row)=>row.active&&row.fixed_day_off!==null&&row.fixed_day_off!==undefined&&!employeesWithPatterns.has(row.id))){
    for(const date of dates){
      if(new Date(`${date}T12:00:00Z`).getUTCDay()!==Number(employee.fixed_day_off))continue;
      if(!shifts.some((shift)=>shift.employee_id===employee.id&&shift.shift_date===date))continue;
      const key=`${employee.id}:${date}`;
      if(!absenceMap.has(key))absenceMap.set(key,{employee_id:employee.id,absence_date:date,absence_type:'day_off_worked',absence_kind:'worked_day_off'});
    }
  }
  return [...absenceMap.values()].sort((a,b)=>`${a.absence_date}-${a.employee_id}`.localeCompare(`${b.absence_date}-${b.employee_id}`));
}
""")
exact("handlers/shifts.js",
"let scheduleAbsences = buildScheduleAbsences(requests, employees, weeklyPatterns, weekStart);",
"let scheduleAbsences = buildScheduleAbsences(requests, employees, weeklyPatterns, shifts, weekStart);")

# ---------- CSS ----------
append_once("styles.css","/* v0.22 schedule experience */",r"""
/* v0.22 schedule experience */
.time-value,.shift-time,input[type="time"]{direction:ltr!important;unicode-bidi:isolate!important}
.time-value{display:inline-block;text-align:left;white-space:nowrap}
.class-priority-fixed{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid var(--border,#dfe3ee);border-radius:14px;background:rgba(111,114,217,.08);grid-column:1/-1}
.class-priority-fixed>span{font-size:20px}.class-priority-fixed small{display:block;margin-top:3px}
.class-priority-fixed.no-fixed{background:rgba(32,166,111,.07)}
.class-priority-row{grid-template-columns:minmax(130px,1fr) minmax(140px,1fr);align-items:end}
#maxWorkDaysField small{display:block;margin-top:4px}
.auto-scope-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}
.auto-scope-card{display:grid;gap:3px;padding:12px;border:1px solid var(--border,#dfe3ee);border-radius:14px;cursor:pointer;background:#fff}
.auto-scope-card input{position:absolute;opacity:0;pointer-events:none}.auto-scope-card.selected{outline:2px solid #6f72d9;background:rgba(111,114,217,.08)}
.auto-date-choices{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;margin:8px 0 16px}
.auto-date-chip{display:grid;text-align:center;gap:2px;padding:9px 5px;border:1px solid var(--border,#dfe3ee);border-radius:12px;cursor:pointer}
.auto-date-chip input{position:absolute;opacity:0}.auto-date-chip.selected{background:rgba(32,166,111,.11);border-color:rgba(32,166,111,.45)}
.auto-issue-presence{margin:8px 0 0;border-top:1px dashed var(--border,#dfe3ee);padding-top:8px}
.auto-issue-presence summary{cursor:pointer;font-weight:700;font-size:.86rem}
.auto-issue-presence>div{display:grid;gap:5px;margin-top:7px}.auto-issue-presence>div>span{display:flex;justify-content:space-between;gap:12px;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.035)}
.picker-status-group{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.shift-modal-actions{display:flex;align-items:center}.modal-action-spacer{flex:1}
.publication-toggle{position:relative;display:inline-flex!important;align-items:center;gap:8px;transition:.2s ease}
.publication-toggle-dot{width:22px;height:12px;border-radius:999px;background:#d4d7df;position:relative;display:inline-block}
.publication-toggle-dot:after{content:"";position:absolute;top:2px;right:2px;width:8px;height:8px;border-radius:50%;background:white;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:.2s ease}
.publication-toggle.is-published .publication-toggle-dot{background:#3eb982}.publication-toggle.is-published .publication-toggle-dot:after{right:12px}
.publication-banner.compact{padding:8px 12px;min-height:auto}.publication-banner.compact small{font-size:.78rem}
.schedule-table{border-collapse:separate;border-spacing:4px;min-width:930px}
.schedule-table th{position:sticky;top:0;z-index:2}.schedule-table td{vertical-align:top;background:#fbfcff;border-radius:10px;padding:5px}
.schedule-cell{display:flex;flex-direction:column;min-height:148px;gap:4px}
.shift-item.is-editable{cursor:pointer;position:relative;transition:transform .12s ease,box-shadow .12s ease;border:1px solid transparent}
.shift-item.is-editable:hover,.shift-item.is-editable:focus-visible{transform:translateY(-1px);box-shadow:0 3px 12px rgba(40,48,80,.12);outline:none;border-color:rgba(111,114,217,.35)}
.shift-item.role-teacher{background:#e8f6ef}.shift-item.role-lead{background:#f1ecfa}.shift-item.role-staff,.shift-item.role-replacement{background:#f4f5f8}
.shift-edit-hint{position:absolute;left:6px;bottom:5px;opacity:.36;font-size:.72rem}
.cell-footer{margin-top:auto;padding-top:5px}.cell-footer .cell-action{width:100%;justify-content:center}
.absence-person.one-time-absence{background:#fff0f0;border:1px solid #efb1b1}.absence-person.one-time-absence .absence-icon{color:#c33}
.absence-person.worked-day-off{background:#edf9f1;border:1px solid #a8dbb8}.absence-person.worked-day-off .absence-icon{color:#168044}
@media(max-width:760px){
  .auto-scope-grid{grid-template-columns:1fr 1fr}.auto-date-choices{grid-template-columns:repeat(3,1fr)}
  .class-priority-row{grid-template-columns:1fr}.shift-modal-actions{flex-wrap:wrap}.modal-action-spacer{display:none;width:100%}
  .shift-modal-actions .danger-btn{order:3;width:100%}
  .shift-item.is-editable{min-height:58px}.shift-edit-hint{left:8px;bottom:8px}
}
""")

# ---------- docs / VERSION ----------
version_text = """# גרסה 0.22.0

## שיבוץ ועריכה
- מסך השבוע נערך כמו לוח השיבוץ/PDF: לחיצה על עובד פותחת עריכה, ובתחתית כל כיתה יש הוספת שיבוץ.
- כפתורי "מחליף" ו"עריכה" אוחדו למסך אחד. העובדים המומלצים והבחירה המלאה נמצאים ברשימה אחת.
- תיקון עריכת שעות: עריכת העובד הקיים שומרת את שעות השיבוץ הנוכחיות במקום לדרוס אותן בשעות הכרטיס.
- מצב הפרסום מוצג פעם אחת בראש המסך כמצב נע בין "מפורסם" ל"שינויים לא פורסמו"; אין "טרם פורסם" על כל עובד.
- שעות מוצגות משמאל לימין גם בממשק RTL.

## כרטיס עובד ומנוע התאמה
- כיתה קבועה היא תמיד עדיפות 1 ומוסתרת מרשימת שאר העדיפויות.
- ללא כיתה קבועה ניתן לדרג את כל הכיתות.
- למשלימ/ת מקום אפשר להגדיר ימים זמינים ובנפרד מקסימום ימי עבודה בשבוע.
- מנוע ההתאמה והשיבוץ האוטומטי משתמשים בסדר העדיפות החדש.

## שיבוץ אוטומטי
- לאחר בחירת שבוע אפשר לבחור את כל השבוע או ימים מסוימים בלבד.
- בנייה מחדש חלקית משנה רק את הימים שנבחרו ושומרת את יתר השבוע.
- בכל נקודת החלטה ניתן לפתוח "מי נמצא כרגע" ולראות את השיבוץ הפעיל באותו חלון.
- משמרת קצרה ביום שאינו שעות עבודה קבועות מוצגת כנקודה שדורשת החלטה.
- מגבלת מספר ימי עבודה בשבוע נאכפת גם באוטומטי וגם בשיבוץ ידני רגיל.

## חופשות וזמינות
- חופשה/מחלה/יום חופשי חד-פעמי מסומנים באדום.
- הגעה בפועל ביום חופשי קבוע מסומנת בירוק.
- ימי חופשי קבועים רגילים אינם מעמיסים עוד את הרשימה.
"""
write("VERSION.md", version_text)

for p in ["README.md","QA-REPORT.md","DEPLOY-VERCEL.md"]:
    if (ROOT/p).exists():
        t=read(p).replace("0.21.0","0.22.0").replace("update-v0.21.0.sql","update-v0.22.0.sql")
        write(p,t)

# ---------- tests ----------
test = r"""const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const root=path.resolve(__dirname,'..');const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const {generateAutomaticSchedule}=require('../lib/auto-schedule');
const {validateWeek}=require('../lib/schedule');

test('0.22 metadata and migration align',()=>{
  assert.equal(JSON.parse(read('package.json')).version,'0.22.0');
  assert.match(read('handlers/health.js'),/schema_version === '0\.22\.0'/);
  const sql=read('supabase/update-v0.22.0.sql');
  assert.match(sql,/max_work_days_per_week/);assert.match(sql,/priority_rank/);assert.doesNotMatch(sql,/drop table/i);
});

test('employee card supports ranked class priorities and substitute weekly day cap',()=>{
  const html=read('index.html'),app=read('app.js'),handler=read('handlers/employees.js');
  assert.match(html,/name="max_work_days_per_week"/);assert.match(app,/עדיפות 1/);assert.match(app,/constraint-priority/);
  assert.match(handler,/max_work_days_per_week/);assert.match(handler,/priority_rank/);
  assert.match(app,/activeClasses\.filter\(\(item\)=>item\.id!==primary\)/);
});

test('partial auto scheduling changes only selected dates',()=>{
  const employees=[{id:'e',full_name:'עובד',active:true,is_schedulable:true,assignment_mode:'substitute',job_title:'סייעת/ סייע',default_start:'07:30',default_end:'15:30'}];
  const classes=[{id:'c',name:'כיתה',active:true}];
  const patterns=Array.from({length:6},(_,weekday)=>({employee_id:'e',weekday,day_type:'as_needed'}));
  const existing=[{id:'keep',employee_id:'e',class_id:'c',shift_date:'2026-08-31',start_time:'07:30',end_time:'08:00',shift_role:'staff',status:'draft'}];
  const settings={opening_time:'07:30',morning_end_time:'08:15',closing_time:'15:30',friday_closing_time:'12:00',morning_required_staff:1,required_staff:1,closing_required_staff:1,closing_window_minutes:30,validation_slot_minutes:30,require_leader:false};
  const plan=generateAutomaticSchedule({weekStart:'2026-08-30',selectedDates:['2026-09-01'],employees,classes,patterns,constraints:[],requests:[],settings,existingShifts:existing,previousShifts:[],mode:'rebuild'});
  assert.deepEqual(plan.selectedDates,['2026-09-01']);
  assert.ok(plan.finalRows.some((row)=>row.id==='keep'&&row.shift_date==='2026-08-31'));
  assert.ok(plan.generated.every((row)=>row.shift_date==='2026-09-01'));
});

test('substitute max work days is enforced by validator',()=>{
  const employee={id:'e',full_name:'משלימה',active:true,is_schedulable:true,max_work_days_per_week:2};
  const shifts=['2026-08-30','2026-08-31','2026-09-01'].map((date)=>({employee_id:'e',class_id:'c',shift_date:date,start_time:'08:15',end_time:'09:00',shift_role:'staff'}));
  const validation=validateWeek({shifts,classes:[{id:'c',name:'כיתה',active:true}],employees:[employee],settings:{opening_time:'07:30',morning_end_time:'08:15',closing_time:'15:30',friday_closing_time:'12:00',morning_required_staff:0,required_staff:0,closing_required_staff:0,closing_window_minutes:30,validation_slot_minutes:30,require_leader:false},weekStart:'2026-08-30',constraints:[],weeklyPatterns:[],requests:[]});
  assert.ok(validation.errors.some((item)=>item.code==='max_weekly_days'));
});

test('editing existing shift preserves current hours and schedule cards are direct-edit',()=>{
  const app=read('app.js');
  assert.match(app,/form\.dataset\.originalEmployeeId=initialEmployee/);
  assert.match(app,/preserveExistingHours/);
  const block=app.slice(app.indexOf('function shiftCardHtml'),app.indexOf('function renderMobileWeekClass'));
  assert.match(block,/data-action="edit"/);assert.doesNotMatch(block,/טרם פורסם/);assert.doesNotMatch(block,/מציאת מחליף/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderScheduleWeek'),app.indexOf('function renderScheduleDay')),/suggest-empty/);
});

test('auto decisions show current staffing and flag short non-fixed shifts',()=>{
  const app=read('app.js'),auto=read('lib/auto-schedule.js');
  assert.match(app,/function autoIssuePresenceHtml/);assert.match(app,/מי נמצא כרגע/);
  assert.match(auto,/short_nonfixed_shift/);assert.match(read('handlers/shifts.js'),/selectedDatesForWeek/);
});

test('absence list shows only one-time absence or worked fixed day off special states',()=>{
  const handler=read('handlers/shifts.js'),app=read('app.js'),css=read('styles.css');
  assert.match(handler,/absence_type:'day_off_worked'/);
  assert.match(handler,/shifts\.some\(\(shift\)=>shift\.employee_id===pattern\.employee_id/);
  assert.match(app,/worked-day-off/);assert.match(css,/one-time-absence/);assert.match(css,/worked-day-off/);
});

test('times are force-isolated LTR in RTL schedule',()=>{assert.match(read('styles.css'),/\.time-value.*direction:ltr/s);});
"""
write("tests/v022.test.js", test)

print("v0.22 patch applied")
