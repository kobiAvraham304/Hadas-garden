#!/usr/bin/env bash
set -euo pipefail

if ! grep -q '"version": "0.19.0"' package.json 2>/dev/null; then
  cat .deploy/v019.b64.part* > /tmp/v019.b64
  base64 --decode /tmp/v019.b64 > /tmp/v019.patch.xz
  xz --decompress --stdout /tmp/v019.patch.xz > /tmp/v019.patch
  git apply --check --binary /tmp/v019.patch
  git apply --binary --whitespace=nowarn /tmp/v019.patch
  echo "v0.19.0 production patch applied"
else
  echo "v0.19.0 base patch already applied"
fi

# Final production hardening for the matching engine.
# A substitute day marked "avoid" remains available only as a low-priority fallback,
# and can never be presented as a recommended candidate.
python3 - <<'PY'
from pathlib import Path

matching = Path('lib/matching.js')
text = matching.read_text(encoding='utf-8')

as_needed = """  if (pattern?.day_type === 'as_needed') return {
    start: short(pattern.start_time) || short(employee.default_start) || '07:30',
    end: short(pattern.end_time) || short(employee.default_end) || (friday ? '12:00' : '15:30'),
    source: 'as_needed',
  };
"""
avoid = """  if (pattern?.day_type === 'avoid') return {
    start: short(pattern.start_time) || short(employee.default_start) || '07:30',
    end: short(pattern.end_time) || short(employee.default_end) || (friday ? '12:00' : '15:30'),
    source: 'avoid',
  };
"""
if "source: 'avoid'" not in text and as_needed in text:
    text = text.replace(as_needed, as_needed + avoid)

text = text.replace("if (constraint?.constraint_type === 'forbidden') { reject('קיים איסור שיבוץ בכיתה'); continue; }",
                    "if (constraint?.constraint_type === 'forbidden') { reject('לא ניתן לשבץ בכיתה זו'); continue; }")

score_line = "    const scoring = scoreCandidate({ employee, targetClassId: classId, neededRole, pattern, constraint, weeklyMinutes, requestedMinutes, candidateType, sourceShift, availability });\n"
if "scoring.recommended = false" not in text and score_line in text:
    text = text.replace(score_line, score_line + "    if (pattern?.day_type === 'avoid') scoring.recommended = false;\n")

matching.write_text(text, encoding='utf-8')

app = Path('app.js')
app_text = app.read_text(encoding='utf-8')
app_text = app_text.replace('גננת משובצת רק בכיתה הקבועה שלה. המערכת תחסום שיבוץ לכיתה אחרת.',
                            'גננת ניתנת לשיבוץ רק בכיתה הקבועה שלה. המערכת תחסום שיבוץ לכיתה אחרת.')
app.write_text(app_text, encoding='utf-8')
PY

node --check app.js
node --check api/index.js
node --check lib/matching.js
node --check lib/auto-schedule.js
node --check lib/schedule.js

echo "v0.19.0 production build verified"
