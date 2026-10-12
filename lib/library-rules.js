const { httpError, isManager } = require('./server');
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 10;
const CATEGORIES = ['meeting','craft','video','music','idea','document'];
const FILE_TYPES = {
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', avif:'image/avif', heic:'image/heic', heif:'image/heif',
  mp4:'video/mp4', mov:'video/quicktime', m4v:'video/mp4', webm:'video/webm',
  mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4', aac:'audio/aac', flac:'audio/flac',
  pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt:'application/vnd.ms-powerpoint', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv:'text/csv', txt:'text/plain', rtf:'application/rtf',
  odt:'application/vnd.oasis.opendocument.text', ods:'application/vnd.oasis.opendocument.spreadsheet', odp:'application/vnd.oasis.opendocument.presentation',
  zip:'application/zip', rar:'application/vnd.rar', '7z':'application/x-7z-compressed',
};
function validateFile(input) {
  const name = String(input.name || '').trim();
  const ext = name.split('.').pop().toLowerCase();
  const size = Number(input.size);
  const supplied = String(input.type || '').split(';')[0].toLowerCase();
  if (!name || name.length > 180 || /[\x00-\x1f/\\]/.test(name) || !FILE_TYPES[ext]) throw httpError(400,'סוג הקובץ אינו נתמך. אפשר להעלות תמונות, וידאו, מוזיקה, מסמכים וקובצי ארכיון');
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_SIZE) throw httpError(400,'גודל הקובץ צריך להיות עד 50MB');
  if (/html|javascript|svg|executable|x-msdownload/.test(supplied)) throw httpError(400,'סוג הקובץ אינו תואם לתוכן נתמך');
  return {name, ext, size, mime:FILE_TYPES[ext]};
}
function cleanItem(body) {
  const title = String(body.title || '').trim();
  if (!title || title.length > 140) throw httpError(400,'יש להזין כותרת עד 140 תווים');
  const category = body.category || 'idea';
  if (!CATEGORIES.includes(category)) throw httpError(400,'יש לבחור סוג תוכן');
  const text = (key,max) => {const value=String(body[key]||'').trim(); if(value.length>max) throw httpError(400,'הטקסט ארוך מדי'); return value;};
  const link = text('link_url',2000);
  if (link) {try {const u=new URL(link); if(!['https:','http:'].includes(u.protocol)||u.username||u.password) throw new Error();}catch{throw httpError(400,'יש להזין קישור מלא שמתחיל ב־https://');}}
  const tags = [...new Set((Array.isArray(body.tags)?body.tags:String(body.tags||'').split(/[,،\n]/)).map(t=>String(t).trim()).filter(Boolean))];
  if(tags.length>8 || tags.some(t=>t.length>35)) throw httpError(400,'אפשר להוסיף עד 8 תגיות קצרות');
  const duration = body.duration_minutes ? Number(body.duration_minutes) : null;
  if(duration!==null && (!Number.isInteger(duration)||duration<1||duration>240)) throw httpError(400,'משך הפעילות צריך להיות 1–240 דקות');
  return {title,category,description:text('description',6000),tags,link_url:link||null,age_range:text('age_range',80),materials:text('materials',1200),adaptations:text('adaptations',1200),duration_minutes:duration};
}
function canRead(caller,item){return Boolean(item && (item.status==='published'||item.status==='draft'&&item.created_by===caller.employee.id));}
function canManage(caller,item){return canRead(caller,item) && (item.created_by===caller.employee.id||item.status==='published'&&isManager(caller));}
function uuid(value){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''))) throw httpError(400,'מזהה התוכן אינו תקין');return value;}
module.exports={MAX_FILE_SIZE,MAX_FILES,CATEGORIES,FILE_TYPES,validateFile,cleanItem,canRead,canManage,uuid};
