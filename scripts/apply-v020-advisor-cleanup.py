from pathlib import Path

root=Path(__file__).resolve().parents[1]
for name in ['supabase/schema.sql','supabase/update-v0.20.0.sql']:
    path=root/name
    text=path.read_text(encoding='utf-8')
    marker="create index if not exists hadas_audit_log_actor_fk_idx on public.hadas_audit_log(actor_employee_id);"
    addition="\ncreate index if not exists hadas_documents_class_fk_idx on public.hadas_documents(class_id);\ncreate index if not exists hadas_documents_created_by_fk_idx on public.hadas_documents(created_by);"
    if 'hadas_documents_class_fk_idx' not in text:
        if text.count(marker)!=1: raise SystemExit(f'index marker guard failed in {name}')
        text=text.replace(marker,marker+addition,1)
    old="'hadas_schedule_publications','hadas_schedule_changes','hadas_attendance','hadas_daily_operations','hadas_requests',"
    new="'hadas_schedule_publications','hadas_schedule_changes','hadas_schedule_acknowledgements','hadas_attendance','hadas_daily_operations','hadas_requests',"
    if old in text:
        text=text.replace(old,new,1)
    elif new not in text:
        raise SystemExit(f'policy-list guard failed in {name}')
    path.write_text(text,encoding='utf-8')

test=root/'tests/v020.test.js'
text=test.read_text(encoding='utf-8')
if 'hadas_documents_class_fk_idx' not in text:
    text=text.replace("'hadas_task_assignees_employee_fk_idx']", "'hadas_task_assignees_employee_fk_idx','hadas_documents_class_fk_idx','hadas_documents_created_by_fk_idx']")
if "hadas_schedule_acknowledgements" not in text:
    text=text.replace("assert.match(migration,/CREATE POLICY hadas_server_only_deny/);", "assert.match(migration,/hadas_schedule_acknowledgements/); assert.match(migration,/CREATE POLICY hadas_server_only_deny/);")
test.write_text(text,encoding='utf-8')
print('v0.20 advisor cleanup applied')
