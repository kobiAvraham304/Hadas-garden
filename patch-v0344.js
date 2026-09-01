/* מעון הדס — פורמט תאריך הודעות 1.9.2026 19:49 */
(() => {
  if (window.__hadasV0344DateDisplayInstalled) return;
  window.__hadasV0344DateDisplayInstalled = true;

  function israelDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone:'Asia/Jerusalem', day:'numeric', month:'numeric', year:'numeric',
      hour:'2-digit', minute:'2-digit', hourCycle:'h23',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${Number(get('day'))}.${Number(get('month'))}.${get('year')} ${get('hour')}:${get('minute')}`;
  }

  const baseRender = window.renderAnnouncements;
  if (typeof baseRender !== 'function') return;
  window.renderAnnouncements = function v0344DateRender() {
    const result = baseRender();
    const rows = [...(state.announcements || [])]
      .sort((a,b)=>Number(Boolean(b.is_pinned))-Number(Boolean(a.is_pinned))||new Date(b.published_at)-new Date(a.published_at))
      .filter((item)=>{
        const read=(state.announcementReads||[]).some((row)=>row.announcement_id===item.id&&row.employee_id===state.profile?.id);
        if(state.announcementViewFilter==='pinned')return item.is_pinned;
        if(state.announcementViewFilter==='unread')return item.requires_acknowledgement!==false&&!read;
        return true;
      });
    document.querySelectorAll('#announcementsList .announcement-card').forEach((card,index)=>{
      const item=rows[index]; if(!item)return;
      const creator=typeof employeeById==='function'?employeeById(item.created_by):null;
      const meta=card.querySelector('.card-heading p.muted');
      if(meta)meta.textContent=`${israelDateTime(item.published_at)}${creator?.full_name?` · ${creator.full_name}`:''}`;
    });
    return result;
  };
})();
