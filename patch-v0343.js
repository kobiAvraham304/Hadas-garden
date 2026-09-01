/* מעון הדס — הודעות: עריכה אמינה, תאריך ברור וצירוף מהגלריה */
(() => {
  if (window.__hadasV0344AnnouncementsInstalled) return;
  window.__hadasV0344AnnouncementsInstalled = true;

  const form = document.querySelector('#announcementForm');
  const dialog = document.querySelector('#announcementDialog');
  const list = document.querySelector('#announcementsList');
  if (!form || !dialog || !list) return;

  const style = document.createElement('style');
  style.textContent = `
    .announcement-attachment-box{grid-column:1/-1;padding:14px;border:1px dashed #c9cbea;border-radius:16px;background:#fafaff}
    .announcement-attachment-box>strong{display:block;margin-bottom:10px}
    .announcement-attachment-actions{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:stretch}
    .announcement-gallery-pick,.announcement-pdf-pick{display:flex;align-items:center;justify-content:center;gap:8px;min-height:50px;border-radius:14px;font-weight:850;cursor:pointer}
    .announcement-gallery-pick{background:#7478e7;color:#fff;border:1px solid #7478e7}
    .announcement-pdf-pick{background:#fff;color:#555b78;border:1px solid #d8daea;padding:0 16px}
    .announcement-gallery-pick input,.announcement-pdf-pick input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
    .announcement-attachment-help{display:block;margin-top:8px;color:#7c8093;font-size:.85rem}
    .announcement-attachment-preview{margin-top:10px;border-radius:14px;overflow:hidden;background:#fff;border:1px solid #e1e3ee}
    .announcement-attachment-preview img{display:block;width:100%;max-height:320px;object-fit:contain;background:#f5f5f8}
    .announcement-attachment-preview .file-line{padding:12px 14px;font-weight:750}
    .announcement-inline-attachment{margin:14px 0;border:1px solid #dfe1ee;border-radius:16px;overflow:hidden;background:#fff}
    .announcement-inline-attachment .attachment-title{padding:10px 14px;font-weight:800;background:#f5f4ff}
    .announcement-inline-attachment img{display:block;width:100%;max-height:520px;object-fit:contain;background:#f7f7fa}
    .announcement-inline-attachment iframe{display:block;width:100%;height:min(68vh,720px);border:0;background:#f7f7fa}
    #announcementForm input[name="published_at"]{direction:ltr;text-align:center;font-variant-numeric:tabular-nums;background:#f7f7fb;color:#31364e;font-weight:800}
    @media(max-width:700px){.announcement-attachment-actions{grid-template-columns:1fr}.announcement-pdf-pick{min-height:46px}.announcement-inline-attachment iframe{height:58vh}}
  `;
  document.head.append(style);

  if (!form.elements.id) form.insertAdjacentHTML('afterbegin', '<input type="hidden" name="id" />');

  const publishedInput = form.elements.published_at;
  publishedInput.type = 'text';
  publishedInput.readOnly = true;
  publishedInput.setAttribute('aria-label', 'מועד פרסום');

  const contentLabel = form.querySelector('textarea[name="body"]')?.closest('label');
  if (contentLabel && !form.querySelector('.announcement-attachment-box')) {
    contentLabel.insertAdjacentHTML('afterend', `
      <section class="announcement-attachment-box">
        <strong>צירוף להודעה</strong>
        <div class="announcement-attachment-actions">
          <label class="announcement-gallery-pick">🖼️ בחירה מהגלריה<input name="announcement_image" type="file" accept="image/*" /></label>
          <label class="announcement-pdf-pick">📄 PDF<input name="announcement_pdf" type="file" accept="application/pdf,.pdf" /></label>
        </div>
        <small class="announcement-attachment-help">לתמונה פשוט לוחצים „בחירה מהגלריה”. התמונה תוצג ישירות בתוך ההודעה.</small>
        <div id="announcementAttachmentPreview" class="announcement-attachment-preview hidden"></div>
      </section>`);
  }

  function israelDateTime(dateValue = new Date()) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${Number(get('day'))}.${Number(get('month'))}.${get('year')} ${get('hour')}:${get('minute')}`;
  }

  function setPublication(dateValue = new Date()) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    publishedInput.dataset.iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    publishedInput.value = israelDateTime(Number.isNaN(date.getTime()) ? new Date() : date);
  }

  function mayEdit(item) {
    return Boolean(isManager() || item?.created_by === state?.profile?.id);
  }

  function attachmentPreview(data, name, type) {
    const preview = document.querySelector('#announcementAttachmentPreview');
    if (!preview) return;
    if (!data) { preview.classList.add('hidden'); preview.innerHTML = ''; return; }
    preview.classList.remove('hidden');
    if (String(type || '').startsWith('image/')) {
      preview.innerHTML = `<img src="${data}" alt="תצוגה מקדימה"><div class="file-line">🖼️ ${escapeHtml(name || 'תמונה')}</div>`;
    } else {
      preview.innerHTML = `<div class="file-line">📄 ${escapeHtml(name || 'מסמך PDF')}</div>`;
    }
  }

  function updateSelectedPreview(file, kind) {
    if (!file) return attachmentPreview(null);
    const other = kind === 'image' ? form.elements.announcement_pdf : form.elements.announcement_image;
    if (other) other.value = '';
    const url = URL.createObjectURL(file);
    attachmentPreview(url, file.name, kind === 'image' ? file.type || 'image/jpeg' : 'application/pdf');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  form.elements.announcement_image?.addEventListener('change', (event) => updateSelectedPreview(event.target.files?.[0], 'image'));
  form.elements.announcement_pdf?.addEventListener('change', (event) => updateSelectedPreview(event.target.files?.[0], 'pdf'));

  function resetComposer() {
    form.reset();
    form.elements.id.value = '';
    setPublication(new Date());
    form.querySelector('input[name="audience_type"][value="all"]')?.click();
    form.querySelector('input[name="announcement_type"][value="info"]')?.click();
    form.elements.requires_acknowledgement.checked = true;
    document.querySelector('#announcementEmployeesField').innerHTML = employeePickerHtml('announcement_employee_ids');
    updateAnnouncementAudience();
    attachmentPreview(null);
    form.querySelector('.modal-heading h3').textContent = 'הודעה חדשה';
    form.querySelector('button[value="default"]').textContent = 'פרסום ההודעה';
  }

  function openNewAnnouncement() {
    resetComposer();
    if (!dialog.open) dialog.showModal();
  }

  function openEditAnnouncement(item) {
    if (!item || !mayEdit(item)) return;
    form.reset();
    form.elements.id.value = item.id;
    form.elements.title.value = item.title || '';
    form.elements.body.value = item.body || '';
    setPublication(item.published_at || new Date());
    form.elements.expires_at.value = item.expires_at ? localDateTimeValue(new Date(item.expires_at)) : '';
    form.elements.is_pinned.checked = Boolean(item.is_pinned);
    form.elements.requires_acknowledgement.checked = item.requires_acknowledgement !== false;
    form.querySelector(`input[name="announcement_type"][value="${item.announcement_type || 'info'}"]`)?.click();
    form.querySelector(`input[name="audience_type"][value="${item.audience_type || 'all'}"]`)?.click();
    form.elements.class_id.value = item.class_id || '';
    document.querySelector('#announcementEmployeesField').innerHTML = employeePickerHtml('announcement_employee_ids');
    const selected = new Set((state.announcementRecipients || []).filter((row) => row.announcement_id === item.id).map((row) => row.employee_id));
    form.querySelectorAll('input[name="announcement_employee_ids"]').forEach((input) => { input.checked = selected.has(input.value); });
    updateAnnouncementAudience();
    attachmentPreview(item.attachment_data, item.attachment_name, item.attachment_type);
    form.querySelector('.modal-heading h3').textContent = 'עריכת הודעה';
    form.querySelector('button[value="default"]').textContent = 'שמירת השינויים';
    if (!dialog.open) dialog.showModal();
  }

  async function imageToDataUrl(file) {
    if (!file) return null;
    if (file.size > 25 * 1024 * 1024) throw new Error('התמונה גדולה מדי. יש לבחור תמונה קטנה יותר.');
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = objectUrl;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      const max = 1800;
      const scale = Math.min(1, max / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0, width, height);
      let quality = 0.86;
      let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      while (blob && blob.size > 2.6 * 1024 * 1024 && quality > 0.55) {
        quality -= 0.1;
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      }
      if (!blob) return fileToDataUrl(file);
      return fileToDataUrl(new File([blob], 'תמונה.jpg', { type: 'image/jpeg' }));
    } catch {
      return fileToDataUrl(file);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function saveComposer(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = form.querySelector('button[value="default"]');
    const id = form.elements.id.value;
    const data = formObject(form);
    data.audience_type = form.querySelector('input[name="audience_type"]:checked')?.value || 'all';
    data.announcement_type = form.querySelector('input[name="announcement_type"]:checked')?.value || 'info';
    data.employee_ids = selectedCheckboxValues(form, 'announcement_employee_ids');
    data.published_at = publishedInput.dataset.iso || new Date().toISOString();
    data.expires_at = toIsoDateTime(data.expires_at);
    data.is_pinned = form.elements.is_pinned.checked;
    data.requires_acknowledgement = form.elements.requires_acknowledgement.checked;
    delete data.announcement_image;
    delete data.announcement_pdf;

    const imageFile = form.elements.announcement_image.files?.[0];
    const pdfFile = form.elements.announcement_pdf.files?.[0];
    if (pdfFile && pdfFile.size > 3 * 1024 * 1024) return showToast('קובץ PDF חייב להיות עד 3MB', 'error');

    if (id) data.id = id;
    setBusy(button, true, id ? 'שומר שינויים…' : 'מפרסם…');
    try {
      if (imageFile) {
        data.attachment_data = await imageToDataUrl(imageFile);
        data.attachment_name = imageFile.name || 'תמונה.jpg';
        data.attachment_type = String(data.attachment_data || '').match(/^data:([^;,]+)/)?.[1] || 'image/jpeg';
      } else if (pdfFile) {
        data.attachment_data = await fileToDataUrl(pdfFile);
        data.attachment_name = pdfFile.name;
        data.attachment_type = 'application/pdf';
      }
      await apiFetch('/api/announcements', { method: id ? 'PATCH' : 'POST', body: data, timeout: 20000 });
      dialog.close();
      await refreshAll();
      showToast(id ? 'ההודעה עודכנה' : 'ההודעה פורסמה', 'success');
    } catch (error) {
      showToast(error.message || 'שמירת ההודעה נכשלה', 'error');
    } finally {
      setBusy(button, false);
    }
  }

  /* Capture listeners intentionally bypass the old already-bound handlers. */
  form.addEventListener('submit', saveComposer, true);
  list.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-action="edit_announcement"]');
    if (!edit) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const item = state.announcements.find((row) => row.id === edit.dataset.id);
    if (item) openEditAnnouncement(item);
  }, true);

  const newButton = document.querySelector('#newAnnouncementBtn');
  newButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openNewAnnouncement();
  }, true);

  const baseRender = window.renderAnnouncements;
  window.renderAnnouncements = function v0344RenderAnnouncements() {
    baseRender();
    const rows = [...state.announcements]
      .sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) || new Date(b.published_at) - new Date(a.published_at))
      .filter((announcement) => {
        const read = state.announcementReads.some((row) => row.announcement_id === announcement.id && row.employee_id === state.profile.id);
        if (state.announcementViewFilter === 'pinned') return announcement.is_pinned;
        if (state.announcementViewFilter === 'unread') return announcement.requires_acknowledgement !== false && !read;
        return true;
      });

    document.querySelectorAll('#announcementsList .announcement-card').forEach((card, index) => {
      const item = rows[index];
      if (!item) return;
      const body = card.querySelector('.announcement-body');
      if (item.attachment_data && body && !card.querySelector('.announcement-inline-attachment')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'announcement-inline-attachment';
        const title = escapeHtml(item.attachment_name || (String(item.attachment_type).startsWith('image/') ? 'תמונה מצורפת' : 'מסמך מצורף'));
        wrapper.innerHTML = String(item.attachment_type || '').startsWith('image/')
          ? `<div class="attachment-title">🖼️ ${title}</div><img src="${item.attachment_data}" alt="${title}">`
          : `<div class="attachment-title">📄 ${title}</div><iframe title="${title}" src="${item.attachment_data}#toolbar=0&navpanes=0&view=FitH"></iframe>`;
        body.insertAdjacentElement('afterend', wrapper);
      }
      if (mayEdit(item)) {
        const actions = card.querySelector('.card-actions');
        if (actions && !actions.querySelector('[data-action="edit_announcement"]')) {
          actions.insertAdjacentHTML('beforeend', `<button type="button" class="ghost-btn" data-action="edit_announcement" data-id="${item.id}">עריכה</button>`);
        }
      }
    });
  };

  window.openAnnouncementDialog = openNewAnnouncement;
})();
