function trimTime(value) {
  return value ? String(value).slice(0, 5) : '';
}
function formatDateIL(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value || '');
}
function hasRequestRange(request) {
  return Boolean(request?.request_end_date && request.request_end_date !== request.request_date);
}
function requestRangeLabel(request) {
  const start = formatDateIL(request?.request_date);
  const end = formatDateIL(request?.request_end_date);
  return hasRequestRange(request) ? `${start} עד ${end}` : start;
}
function requestDatePhrase(request) {
  return `${hasRequestRange(request) ? 'לתאריכים' : 'לתאריך'} ${requestRangeLabel(request)}`;
}
function approvalMessage(request, managerNote = '') {
  const when = requestDatePhrase(request);
  let message;
  switch (request?.request_type) {
    case 'leave': message = `בקשת החופשה שלך ${when} אושרה.`; break;
    case 'day_off': message = `בקשת היום החופשי שלך ${when} אושרה.`; break;
    case 'late_start': message = `בקשת ההתחלה המאוחרת שלך ${when} אושרה. שעת ההתחלה המאושרת: ${trimTime(request.requested_start)}.`; break;
    case 'early_finish': message = `בקשת הסיום המוקדם שלך ${when} אושרה. שעת הסיום המאושרת: ${trimTime(request.requested_end)}.`; break;
    case 'sick': message = `דיווח המחלה שלך ${when} אושר.`; break;
    case 'swap': message = `בקשת ההחלפה שלך ${when} אושרה והשיבוץ עודכן בהתאם.`; break;
    default: message = `הבקשה שלך ${when} אושרה.`;
  }
  const note = String(managerNote || '').trim();
  return note ? `${message} הערת הנהלה: ${note}` : message;
}
function rejectionMessage(request, managerNote = '') {
  const message = `הבקשה שלך ${requestDatePhrase(request)} נדחתה.`;
  const note = String(managerNote || '').trim();
  return note ? `${message} סיבת הדחייה: ${note}` : message;
}
module.exports = { trimTime, formatDateIL, hasRequestRange, requestRangeLabel, requestDatePhrase, approvalMessage, rejectionMessage };
