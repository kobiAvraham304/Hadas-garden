from pathlib import Path

p=Path('scripts/apply-v021-scheduling.py')
lines=p.read_text(encoding='utf-8').splitlines()

# Repair accidental physical newlines inside raw regex string arguments.
out=[]
i=0
while i < len(lines):
    line=lines[i]
    if line.lstrip().startswith('regex_once(') and line.count('"') % 2 == 1:
        combined=line
        i += 1
        while i < len(lines) and combined.count('"') % 2 == 1:
            combined += r'\n' + lines[i]
            i += 1
        out.append(combined)
    else:
        out.append(line)
        i += 1
lines=out

# Replace the PDF guard with the actual existing two-line source shape.
marker='# Sort PDF cell items by role before drawing.'
try:
    idx=lines.index(marker)
except ValueError:
    raise SystemExit('PDF marker not found in patch script')
# marker + replace_once + old triple + new triple = 4 lines total after marker in source script
if idx+3 >= len(lines) or not lines[idx+1].startswith("replace_once('app.js'"):
    raise SystemExit('Unexpected PDF patch block shape')
replacement = "regex_once('app.js',r\"      const items = shifts\\.filter\\(\\(shift\\) => shift\\.shift_date === iso && shift\\.class_id === classItem\\.id\\)\\n        \\.sort\\(\\(a, b\\) => String\\(a\\.start_time\\)\\.localeCompare\\(String\\(b\\.start_time\\)\\) \\|\\| \\(employeeById\\(a\\.employee_id\\)\\?\\.full_name \\|\\| ''\\)\\.localeCompare\\(employeeById\\(b\\.employee_id\\)\\?\\.full_name \\|\\| '', 'he'\\)\\);\",'''      const items = sortScheduleRows(shifts.filter((shift) => shift.shift_date === iso && shift.class_id === classItem.id));''')"
lines[idx:idx+4]=[marker,replacement]

p.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('v0.21 patch script prepared')
