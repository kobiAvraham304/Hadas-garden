/* מעון הדס — הודעות: PDF, עריכה ותאריך מקומי */
(() => {
  if (window.__hadasV0343Installed) return;
  window.__hadasV0343Installed = true;

  const form = document.querySelector('#announcementForm');
  if (!form) return;
  form.insertAdjacentHTML('afterbegin', '<input type="hidden" name="id" />');
  const content = form.querySelector('textarea[name="body"]')?.closest('label');
  if (content) content.insertAdjacentHTML('afterend', '<label class="full-field announcement-pdf-field"><span>קובץ PDF מצורף</span><input name="announcement_pdf" type="file" accept="application/pdf,.pdf" /><small>PDF בלבד, עד 4MB. הקובץ יוצג ישירות בתוך ההודעה.</small><div id="announcementExistingPdf" class="hidden"></div></label>');

  const baseOpen = window.openAnnouncementDialog;
  window.openAnnouncementDialog = function(item = null) {
    if (!item) {
      baseOpen();
      form.elements.id.value = '';
      form.querySelector('.modal-heading h3').textContent = 'הודעה חדשה';
      return;
    }
    form.reset();
    form.elements.id.value = item.id;
    form.elements.title.value = item.title || '';
    form.elements.body.value = item.body || '';
    form.elements.published_at.value = localDateTimeValue(new Date(item.published_at));
    form.elements.expires_at.value = item.expires_at ? localDateTimeValue(new Date(item.expires_at)) : '';
    form.elements.is_pinned.checked = Boolean(item.is_pinned);
    form.elements.requires_acknowledgement.checked = item.requires_acknowledgement !== false;
    const type = form.querySelector(`input[name="announcement_type"][value="${item.announcement_type || 'info'}"]`); if (type) type.checked = true;
    const audience = form.querySelector(`input[name="audience_type"][value="${item.audience_type || 'all'}"]`); if (audience) audience.checked = true;
    form.elements.class_id.value = item.class_id || '';
    document.querySelector('#announcementEmployeesField').innerHTML = employeePickerHtml('announcement_employee_ids');
    const selected = new Set((state.announcementRecipients || []).filter(r => r.announcement_id === item.id).map(r => r.employee_id));
    form.querySelectorAll('input[name="announcement_employee_ids"]').forEach(input => { input.checked = selected.has(input.value); });
    updateAnnouncementAudience();
    const existing = document.querySelector('#announcementExistingPdf');
    if (item.attachment_data) { existing.classList.remove('hidden'); existing.textContent = `📎 קיים: ${item.attachment_name || 'קובץ PDF'} — בחירת קובץ חדש תחליף אותו.`; } else existing.classList.add('hidden');
    form.querySelector('.modal-heading h3').textContent = 'עריכת הודעה';
    form.querySelector('button[value="default"]').textContent = 'שמירת השינויים';
    document.querySelector('#announcementDialog').showModal();
  };

  window.saveAnnouncement = async function(event) {
    event.preventDefault();
    const button=form.querySelector('button[value="default"]'), data=formObject(form), id=form.elements.id.value;
    data.audience_type=form.querySelector('input[name="audience_type"]:checked')?.value||'all';
    data.announcement_type=form.querySelector('input[name="announcement_type"]:checked')?.value||'info';
    data.employee_ids=selectedCheckboxValues(form,'announcement_employee_ids');
    data.published_at=toIsoDateTime(data.published_at)||new Date().toISOString(); data.expires_at=toIsoDateTime(data.expires_at);
    data.is_pinned=form.elements.is_pinned.checked; data.requires_acknowledgement=form.elements.requires_acknowledgement.checked;
    delete data.announcement_pdf;
    const file=form.elements.announcement_pdf.files?.[0];
    if(file){ if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')) return showToast('ניתן לצרף קובץ PDF בלבד','error'); if(file.size>4*1024*1024)return showToast('קובץ PDF חייב להיות עד 4MB','error'); data.attachment_data=await fileToDataUrl(file);data.attachment_name=file.name;data.attachment_type='application/pdf'; }
    if(id)data.id=id;
    setBusy(button,true,id?'שומר שינויים…':'מפרסם…');
    try{await apiFetch('/api/announcements',{method:id?'PATCH':'POST',body:data,timeout:20000});document.querySelector('#announcementDialog').close();await refreshAll();showToast(id?'ההודעה עודכנה':'ההודעה פורסמה','success');}catch(error){showToast(error.message,'error');}finally{setBusy(button,false);}
  };

  const baseRender = window.renderAnnouncements;
  window.renderAnnouncements = function(){
    baseRender();
    document.querySelectorAll('#announcementsList .announcement-card').forEach((card,index)=>{
      const rows=[...state.announcements].sort((a,b)=>Number(Boolean(b.is_pinned))-Number(Boolean(a.is_pinned))||new Date(b.published_at)-new Date(a.published_at)).filter(a=>{const read=state.announcementReads.some(r=>r.announcement_id===a.id&&r.employee_id===state.profile.id);if(state.announcementViewFilter==='pinned')return a.is_pinned;if(state.announcementViewFilter==='unread')return a.requires_acknowledgement!==false&&!read;return true;});
      const item=rows[index]; if(!item)return;
      const body=card.querySelector('.announcement-body');
      if(item.attachment_data&&body){const embed=document.createElement('div');embed.className='announcement-pdf-embed';embed.innerHTML=`<div class="announcement-pdf-title">📄 ${escapeHtml(item.attachment_name||'מסמך מצורף')}</div><iframe title="${escapeHtml(item.attachment_name||'PDF מצורף')}" src="${item.attachment_data}#toolbar=0&navpanes=0&view=FitH"></iframe>`;body.insertAdjacentElement('afterend',embed);}
      if(canManageCreated(item)){const actions=card.querySelector('.card-actions');const edit=document.createElement('button');edit.type='button';edit.className='ghost-btn';edit.dataset.action='edit_announcement';edit.dataset.id=item.id;edit.textContent='עריכה';actions?.insertBefore(edit,actions.querySelector('.danger-btn'));}
    });
  };

  const baseClick = window.handleAnnouncementClick;
  window.handleAnnouncementClick = function(event){const edit=event.target.closest('[data-action="edit_announcement"]');if(edit){const item=state.announcements.find(row=>row.id===edit.dataset.id);if(item)window.openAnnouncementDialog(item);return;}return baseClick(event);};

  // Avoid browser-dependent datetime-local parsing: input is Israel wall time.
  window.toIsoDateTime = function(value){if(!value)return null;const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);if(!match)return null;const [,y,m,d,h,min]=match;const probe=new Date(`${y}-${m}-${d}T${h}:${min}:00+03:00`);return probe.toISOString();};
})();
