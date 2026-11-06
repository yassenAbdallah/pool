/* =========================================================
   مساحتي — منطق الموقع
   - كلمة السر 123  =>  وضع الدفتر (إضافة/تعديل/حذف)
   - كلمة السر 321  =>  وضع البيانات (عرض فقط + تصدير)
   البيانات بتتحفظ في localStorage على نفس المتصفح.
   ========================================================= */
(() => {
  'use strict';

  const PASSWORDS = { '123': 'notebook', '321': 'data' };
  const STORE_KEY = 'masahy.records.v1';
  const SESSION_KEY = 'masahy.session.v1';
  const ALL = '__all__';

  const $ = (id) => document.getElementById(id);

  const el = {
    loginScreen: $('screen-login'),
    appScreen: $('screen-app'),
    loginForm: $('login-form'),
    password: $('password'),
    togglePass: $('toggle-pass'),
    remember: $('remember'),
    loginError: $('login-error'),

    roleBadge: $('role-badge'),
    logout: $('logout'),

    viewNotebook: $('view-notebook'),
    viewData: $('view-data'),

    nbCount: $('nb-count'),
    nbSearch: $('nb-search'),
    nbList: $('nb-list'),
    nbEmpty: $('nb-empty'),
    nbEmptyText: $('nb-empty-text'),

    recordForm: $('record-form'),
    formTitle: $('form-title'),
    fTitle: $('f-title'),
    fCategory: $('f-category'),
    fContent: $('f-content'),
    saveBtn: $('save-btn'),
    cancelBtn: $('cancel-btn'),

    stats: $('stats'),
    dSearch: $('d-search'),
    dFilter: $('d-filter'),
    dTableWrap: $('d-table-wrap'),
    dBody: $('d-body'),
    dEmpty: $('d-empty'),
    dEmptyText: $('d-empty-text'),
    exportCsv: $('export-csv'),
    exportJson: $('export-json'),

    toast: $('toast'),
    modal: $('modal'),
    modalClose: $('modal-close'),
    mTitle: $('m-title'),
    mMeta: $('m-meta'),
    mBody: $('m-body'),
  };

  /** @type {'notebook'|'data'|null} */
  let role = null;
  let records = [];
  let editingId = null;
  let toastTimer = null;

  /* ================= التخزين ================= */
  const uid = () =>
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : 'r' + Date.now().toString(36) + Math.random().toString(16).slice(2);

  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(isRecord) : [];
    } catch {
      return [];
    }
  }

  function isRecord(r) {
    return r && typeof r === 'object' && typeof r.id === 'string' && typeof r.title === 'string';
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(records));
    } catch {
      toast('مش قادر أحفظ البيانات — مساحة المتصفح ممكن تكون مليانة.', 'error');
    }
  }

  /* ================= الجلسة ================= */
  function readSession() {
    for (const store of [sessionStorage, localStorage]) {
      try {
        const raw = store.getItem(SESSION_KEY);
        if (!raw) continue;
        const s = JSON.parse(raw);
        if (s && (s.role === 'notebook' || s.role === 'data')) return s;
      } catch {
        /* تجاهل */
      }
    }
    return null;
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* تجاهل */
    }
  }

  function writeSession(newRole, remember) {
    const payload = JSON.stringify({ role: newRole, at: Date.now() });
    clearSession();
    try {
      (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, payload);
    } catch {
      /* تجاهل */
    }
  }

  /* ================= أدوات مساعدة ================= */
  const numFmt = new Intl.NumberFormat('ar-EG-u-nu-latn');

  function fmtDateTime(ts) {
    if (!ts) return '—';
    try {
      return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleString();
    }
  }

  function fmtDateShort(ts) {
    if (!ts) return '—';
    try {
      return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleDateString();
    }
  }

  function toast(message, kind = 'ok') {
    el.toast.textContent = message;
    el.toast.className = 'toast show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.className = 'toast ' + kind;
    }, 2600);
  }

  function snippet(text, max = 60) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max) + '…' : clean;
  }

  /* ================= الدخول والخروج ================= */
  function showLoginError(message) {
    el.loginError.textContent = message;
    el.password.classList.remove('shake');
    // إعادة تشغيل الأنيميشن
    void el.password.offsetWidth;
    el.password.classList.add('shake');
    el.password.select();
  }

  function enterApp(newRole) {
    role = newRole;
    el.roleBadge.textContent = newRole === 'notebook' ? '📓 وضع الدفتر' : '📊 وضع البيانات';
    el.roleBadge.classList.toggle('data', newRole === 'data');
    el.viewNotebook.hidden = newRole !== 'notebook';
    el.viewData.hidden = newRole !== 'data';
    el.loginScreen.classList.remove('active');
    el.appScreen.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'auto' });
    refresh(newRole === 'notebook');
  }

  function logout() {
    clearSession();
    role = null;
    resetForm();
    el.dSearch.value = '';
    el.nbSearch.value = '';
    el.appScreen.classList.remove('active');
    el.loginScreen.classList.add('active');
    el.password.value = '';
    el.loginError.textContent = '';
    el.password.focus();
  }

  function refresh(focusTitle = false) {
    records = loadRecords();
    if (role === 'notebook') {
      renderNotebook();
      if (focusTitle) el.fTitle.focus();
    } else if (role === 'data') {
      renderData();
    }
  }

  /* ================= الدفتر ================= */
  function renderNotebook() {
    el.nbCount.textContent = numFmt.format(records.length);

    const q = el.nbSearch.value.trim().toLowerCase();
    const list = records
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .filter((r) => !q || `${r.title} ${r.content || ''} ${r.category || ''}`.toLowerCase().includes(q));

    el.nbList.replaceChildren();
    for (const r of list) el.nbList.appendChild(noteCard(r));

    const isEmpty = list.length === 0;
    el.nbEmpty.hidden = !isEmpty;
    if (isEmpty) {
      el.nbEmptyText.textContent = records.length
        ? 'مفيش نتايج مطابقة للبحث.'
        : 'لسه مفيش سجلات… ابدأ بسجل جديد من الفورم.';
    }
  }

  function noteCard(r) {
    const card = document.createElement('article');
    card.className = 'note';
    card.dataset.id = r.id;

    const top = document.createElement('div');
    top.className = 'note-top';

    const title = document.createElement('h4');
    title.textContent = r.title;

    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = r.category || 'عام';

    top.append(title, chip);

    const body = document.createElement('p');
    body.className = 'note-body';
    body.textContent = r.content || '—';

    const foot = document.createElement('div');
    foot.className = 'note-foot';

    const time = document.createElement('time');
    time.dateTime = new Date(r.updatedAt || r.createdAt || Date.now()).toISOString();
    time.textContent = fmtDateShort(r.updatedAt || r.createdAt);

    const actions = document.createElement('div');
    actions.className = 'note-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.dataset.act = 'edit';
    editBtn.title = 'تعديل';
    editBtn.setAttribute('aria-label', 'تعديل السجل');
    editBtn.textContent = '✎';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn danger';
    delBtn.dataset.act = 'del';
    delBtn.title = 'حذف';
    delBtn.setAttribute('aria-label', 'حذف السجل');
    delBtn.textContent = '🗑';

    actions.append(editBtn, delBtn);
    foot.append(time, actions);

    card.append(top, body, foot);
    return card;
  }

  function ensureCategory(value) {
    const exists = [...el.fCategory.options].some((o) => o.value === value);
    if (!exists && value) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      el.fCategory.appendChild(opt);
    }
  }

  function startEdit(id) {
    const r = records.find((x) => x.id === id);
    if (!r) return;

    editingId = id;
    ensureCategory(r.category || 'عام');
    el.formTitle.textContent = 'تعديل السجل';
    el.fTitle.value = r.title;
    el.fCategory.value = r.category || 'عام';
    el.fContent.value = r.content || '';
    el.saveBtn.textContent = 'تحديث';
    el.cancelBtn.hidden = false;
    el.recordForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.fTitle.focus({ preventScroll: true });
  }

  function resetForm() {
    editingId = null;
    el.recordForm.reset();
    el.fCategory.value = 'عام';
    el.formTitle.textContent = 'سجل جديد';
    el.saveBtn.textContent = 'حفظ';
    el.cancelBtn.hidden = true;
  }

  function removeRecord(id) {
    const r = records.find((x) => x.id === id);
    if (!r) return;
    if (!window.confirm(`تحذف السجل «${r.title}»؟`)) return;

    records = records.filter((x) => x.id !== id);
    persist();
    if (editingId === id) resetForm();
    renderNotebook();
    toast('تم حذف السجل', 'ok');
  }

  /* ================= البيانات ================= */
  function renderData() {
    const total = records.length;
    const categories = [...new Set(records.map((r) => r.category || 'عام'))];
    const last = records.reduce((m, r) => Math.max(m, r.updatedAt || r.createdAt || 0), 0);

    el.stats.replaceChildren(
      statCard('إجمالي السجلات', numFmt.format(total)),
      statCard('عدد التصنيفات', numFmt.format(categories.length)),
      statCard('آخر تحديث', last ? fmtDateShort(last) : '—')
    );

    syncFilterOptions(categories);

    const q = el.dSearch.value.trim().toLowerCase();
    const cat = el.dFilter.value || ALL;

    const list = records
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .filter((r) => {
        const catOk = cat === ALL || (r.category || 'عام') === cat;
        const textOk = !q || `${r.title} ${r.content || ''}`.toLowerCase().includes(q);
        return catOk && textOk;
      });

    el.dBody.replaceChildren();
    list.forEach((r, i) => el.dBody.appendChild(tableRow(r, i)));

    const isEmpty = list.length === 0;
    el.dEmpty.hidden = !isEmpty;
    el.dTableWrap.hidden = isEmpty;
    if (isEmpty) {
      el.dEmptyText.textContent =
        total === 0
          ? 'مفيش بيانات لسه… سجّل أول حاجة من صفحة الدفتر.'
          : 'مفيش نتايج مطابقة للبحث أو الفلتر.';
    }
  }

  function statCard(label, value) {
    const box = document.createElement('div');
    box.className = 'stat';

    const l = document.createElement('div');
    l.className = 'label';
    l.textContent = label;

    const v = document.createElement('div');
    v.className = 'value';
    v.textContent = value;

    box.append(l, v);
    return box;
  }

  function syncFilterOptions(categories) {
    const current = el.dFilter.value || ALL;
    el.dFilter.replaceChildren();

    const all = document.createElement('option');
    all.value = ALL;
    all.textContent = 'كل التصنيفات';
    el.dFilter.appendChild(all);

    for (const cat of categories) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      el.dFilter.appendChild(opt);
    }

    el.dFilter.value = categories.includes(current) ? current : ALL;
  }

  function tableRow(r, index) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    tr.tabIndex = 0;
    tr.title = 'اضغط لعرض التفاصيل';
    tr.setAttribute('aria-label', `عرض السجل ${r.title}`);

    const tdNum = document.createElement('td');
    tdNum.textContent = numFmt.format(index + 1);

    const tdTitle = document.createElement('td');
    const spanTitle = document.createElement('span');
    spanTitle.className = 'cell-title';
    spanTitle.textContent = r.title;
    tdTitle.appendChild(spanTitle);

    const tdCat = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = r.category || 'عام';
    tdCat.appendChild(chip);

    const tdSnippet = document.createElement('td');
    const snip = document.createElement('span');
    snip.className = 'cell-snippet';
    snip.textContent = snippet(r.content, 70) || '—';
    tdSnippet.appendChild(snip);

    const tdDate = document.createElement('td');
    tdDate.textContent = fmtDateTime(r.updatedAt || r.createdAt);

    const tdOpen = document.createElement('td');
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'icon-btn';
    openBtn.title = 'عرض';
    openBtn.setAttribute('aria-label', 'عرض التفاصيل');
    openBtn.textContent = '↗';
    tdOpen.appendChild(openBtn);

    tr.append(tdNum, tdTitle, tdCat, tdSnippet, tdDate, tdOpen);
    return tr;
  }

  /* ================= المودال ================= */
  function openModal(r) {
    el.mTitle.textContent = r.title;
    el.mMeta.replaceChildren();

    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = r.category || 'عام';

    const time = document.createElement('span');
    time.className = 'muted small';
    time.textContent = 'آخر تحديث: ' + fmtDateTime(r.updatedAt || r.createdAt);

    el.mMeta.append(chip, time);
    el.mBody.textContent = r.content || '—';

    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    el.modalClose.focus();
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
  }

  /* ================= التصدير ================= */
  function csvCell(value) {
    return '"' + String(value ?? '').replace(/"/g, '""') + '"';
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function exportCSV() {
    if (!records.length) {
      toast('مفيش بيانات للتصدير', 'error');
      return;
    }
    const sorted = records.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const rows = [
      ['العنوان', 'التصنيف', 'التفاصيل', 'تاريخ الإنشاء', 'آخر تحديث'],
      ...sorted.map((r) => [
        r.title,
        r.category || 'عام',
        r.content || '',
        fmtDateTime(r.createdAt),
        fmtDateTime(r.updatedAt),
      ]),
    ];
    const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    download(`data-${stamp()}.csv`, csv, 'text/csv;charset=utf-8');
    toast('تم تصدير CSV', 'ok');
  }

  function exportJSON() {
    if (!records.length) {
      toast('مفيش بيانات للتصدير', 'error');
      return;
    }
    download(`data-${stamp()}.json`, JSON.stringify(records, null, 2), 'application/json;charset=utf-8');
    toast('تم تصدير JSON', 'ok');
  }

  /* ================= الأحداث ================= */
  el.loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pass = el.password.value.trim();
    const newRole = PASSWORDS[pass];

    if (!newRole) {
      showLoginError('كلمة السر غلط، جرّب تاني.');
      return;
    }

    el.loginError.textContent = '';
    writeSession(newRole, el.remember.checked);
    el.password.value = '';
    enterApp(newRole);
  });

  el.password.addEventListener('input', () => {
    if (el.loginError.textContent) el.loginError.textContent = '';
  });

  el.togglePass.addEventListener('click', () => {
    const show = el.password.type === 'password';
    el.password.type = show ? 'text' : 'password';
    el.togglePass.textContent = show ? '🙈' : '👁';
    el.togglePass.setAttribute('aria-label', show ? 'إخفاء كلمة السر' : 'إظهار كلمة السر');
    el.password.focus();
  });

  el.logout.addEventListener('click', logout);

  el.nbSearch.addEventListener('input', renderNotebook);

  el.recordForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const title = el.fTitle.value.trim();
    const content = el.fContent.value.trim();
    const category = el.fCategory.value || 'عام';

    if (!title) {
      toast('اكتب عنوان للسجل', 'error');
      el.fTitle.focus();
      return;
    }
    if (!content) {
      toast('اكتب التفاصيل', 'error');
      el.fContent.focus();
      return;
    }

    const now = Date.now();

    if (editingId) {
      const idx = records.findIndex((r) => r.id === editingId);
      if (idx > -1) {
        records[idx] = { ...records[idx], title, category, content, updatedAt: now };
      }
      toast('تم تحديث السجل', 'ok');
    } else {
      records.unshift({
        id: uid(),
        title,
        category,
        content,
        createdAt: now,
        updatedAt: now,
      });
      toast('تم حفظ السجل', 'ok');
    }

    persist();
    resetForm();
    renderNotebook();
    el.fTitle.focus();
  });

  el.recordForm.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      el.recordForm.requestSubmit();
    }
  });

  el.cancelBtn.addEventListener('click', () => {
    resetForm();
    el.fTitle.focus();
  });

  el.nbList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-id]');
    if (!card) return;

    if (btn.dataset.act === 'edit') startEdit(card.dataset.id);
    else if (btn.dataset.act === 'del') removeRecord(card.dataset.id);
  });

  el.dSearch.addEventListener('input', renderData);
  el.dFilter.addEventListener('change', renderData);
  el.exportCsv.addEventListener('click', exportCSV);
  el.exportJson.addEventListener('click', exportJSON);

  el.dBody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const r = records.find((x) => x.id === tr.dataset.id);
    if (r) openModal(r);
  });

  el.dBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    e.preventDefault();
    const r = records.find((x) => x.id === tr.dataset.id);
    if (r) openModal(r);
  });

  el.modal.addEventListener('click', (e) => {
    if (e.target === el.modal) closeModal();
  });
  el.modalClose.addEventListener('click', closeModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.hidden) closeModal();
  });

  // مزامنة لو البيانات اتغيرت في تاب تاني
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY && role) {
      records = loadRecords();
      if (role === 'notebook') renderNotebook();
      else renderData();
    }
  });

  /* ================= بدء التشغيل ================= */
  const session = readSession();
  if (session) enterApp(session.role);
  else el.password.focus();
})();
