/* =========================================================
   مساحتي — منطق الموقع
   - كلمة السر 123  =>  وضع الدفتر (إضافة/تعديل/حذف)
   - كلمة السر 321  =>  وضع البيانات (عرض فقط + تصدير)
   - الحفظ في ملف JSON على الجهاز عبر File System Access API
     (Chrome / Edge). لو المتصفح مش بيدعمها: حفظ في localStorage.
   ========================================================= */
(() => {
  'use strict';

  const PASSWORDS = { '123': 'notebook', '321': 'data' };
  const LEGACY_KEY = 'masahy.records.v1';
  const SESSION_KEY = 'masahy.session.v1';
  const HANDLE_KEY = 'datafile';
  const CACHE_KEY = 'records-cache';
  const ALL = '__all__';
  const supportsFS =
    typeof window.showSaveFilePicker === 'function' &&
    typeof window.showOpenFilePicker === 'function';

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
    filePill: $('file-pill'),
    fileName: $('file-name'),
    fileBanner: $('file-banner'),
    bannerText: $('banner-text'),
    bannerConnect: $('banner-connect'),

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
    refreshFile: $('refresh-file'),
    exportCsv: $('export-csv'),
    exportJson: $('export-json'),

    toast: $('toast'),
    modal: $('modal'),
    modalClose: $('modal-close'),
    mTitle: $('m-title'),
    mMeta: $('m-meta'),
    mBody: $('m-body'),

    connectModal: $('connect-modal'),
    connectClose: $('connect-close'),
    connectFile: $('connect-file'),
    connectError: $('connect-error'),
    connectNote: $('connect-note'),
    btnNew: $('btn-new'),
    btnOpen: $('btn-open'),
    btnReconnect: $('btn-reconnect'),
    btnLocal: $('btn-local'),
  };

  /** @type {'notebook'|'data'|null} */
  let role = null;
  /** @type {'file'|'local'} */
  let mode = supportsFS ? 'file' : 'file';
  let connected = false;
  let dirty = false;
  let fileHandle = null;
  let storedHandle = null;

  let records = [];
  let editingId = null;
  let toastTimer = null;
  let picking = false;

  const uid = () =>
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : 'r' + Date.now().toString(36) + Math.random().toString(16).slice(2);

  /* ================= IndexedDB (لتخزين مقبض الملف) ================= */
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('masahy-fs', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const rq = tx.objectStore('kv').get(key);
      rq.onsuccess = () => resolve(rq.result ?? null);
      rq.onerror = () => reject(rq.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /* نسخة محلية من السجلات: تظهر فورًا وتشتغل من غير نت،
     والملف يفضل هو المصدر الرسمي للحفظ. */
  async function readCache() {
    try {
      const value = await idbGet(CACHE_KEY);
      return Array.isArray(value) ? value.filter(isRecord) : [];
    } catch {
      return [];
    }
  }

  async function writeCache() {
    try {
      await idbSet(CACHE_KEY, records);
    } catch {
      /* تجاهل */
    }
  }

  /* ================= قراءة/كتابة ملف JSON ================= */
  function isRecord(r) {
    return r && typeof r === 'object' && typeof r.id === 'string' && typeof r.title === 'string';
  }

  async function readFromFile() {
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text.trim()) return [];

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('bad-json');
    }

    const list = Array.isArray(parsed)
      ? parsed
      : parsed && Array.isArray(parsed.records)
        ? parsed.records
        : [];

    return list.filter(isRecord);
  }

  async function writeToFile() {
    if (!fileHandle) throw new Error('no-handle');

    const payload = JSON.stringify(
      {
        app: 'masahy',
        version: 1,
        updatedAt: new Date().toISOString(),
        records,
      },
      null,
      2
    );

    const writable = await fileHandle.createWritable();
    try {
      await writable.write(payload);
      await writable.close();
    } catch (err) {
      try {
        await writable.abort();
      } catch {
        /* تجاهل */
      }
      throw err;
    }
  }

  function readLegacy() {
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(isRecord) : [];
    } catch {
      return [];
    }
  }

  /* ================= ربط الملف ================= */
  async function attachHandle(handle, opts = {}) {
    try {
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') throw new Error('permission');

      fileHandle = handle;
      storedHandle = handle;
      idbSet(HANDLE_KEY, handle).catch(() => {});

      let next = records;
      let migrated = false;

      if (!dirty) {
        const fromFile = await readFromFile();
        next = fromFile;
        if (!next.length) {
          const legacy = readLegacy();
          if (legacy.length) {
            next = legacy;
            migrated = true;
          }
        }
      }

      records = next;
      mode = 'file';
      connected = true;
      writeCache();

      if (migrated || opts.fresh || dirty) {
        await writeToFile();
        dirty = false;
        if (migrated) localStorage.removeItem(LEGACY_KEY);
      }

      el.connectError.textContent = '';
      closeConnectModal();
      updateFileUI();
      renderCurrent();

      if (!opts.silent) {
        toast(migrated ? 'تم ربط الملف ونقل بياناتك القديمة' : 'تم ربط ملف البيانات', 'ok');
      }
    } catch (err) {
      connected = false;
      fileHandle = null;
      dirty = false;
      updateFileUI();

      if (err && err.name === 'AbortError') return;

      let msg = 'تعذر ربط الملف.';
      if (err && err.name === 'NotAllowedError') msg = 'محتاج إذن الكتابة في الملف.';
      else if (err && err.message === 'bad-json') msg = 'الملف ده مش JSON صالح. اختار ملف تاني.';
      else if (err && err.name === 'NotFoundError') msg = 'الملف مش موجود. اختار ملف تاني.';

      el.connectError.textContent = msg;
      openConnectModal();
      toast(msg, 'error');
      renderCurrent();
    }
  }

  async function pickNewFile() {
    if (picking) return;
    picking = true;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'masahy-data.json',
        types: [{ description: 'ملف JSON', accept: { 'application/json': ['.json'] } }],
      });
      await attachHandle(handle, { fresh: true });
    } catch (err) {
      if (!err || err.name !== 'AbortError') {
        el.connectError.textContent = 'تعذر إنشاء الملف. جرّب تاني.';
        openConnectModal();
      }
    } finally {
      picking = false;
    }
  }

  async function pickExistingFile() {
    if (picking) return;
    picking = true;
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'ملف JSON', accept: { 'application/json': ['.json'] } }],
      });
      await attachHandle(handle, {});
    } catch (err) {
      if (!err || err.name !== 'AbortError') {
        el.connectError.textContent = 'تعذر فتح الملف. جرّب تاني.';
        openConnectModal();
      }
    } finally {
      picking = false;
    }
  }

  async function reconnectStored() {
    if (!storedHandle) {
      openConnectModal();
      return;
    }
    picking = true;
    try {
      await attachHandle(storedHandle, {});
    } finally {
      picking = false;
    }
  }

  /* ================= الحفظ ================= */
  function storageReady() {
    if (mode === 'local' || connected) return true;
    // لو الملف معروف على الجهاز: نسمح بالتعديل مؤقتًا ونكتبه في الملف بعد الربط
    if (storedHandle) return true;
    openConnectModal();
    toast('اربط ملف JSON الأول عشان نقدر نحفظ', 'error');
    return false;
  }

  async function persist() {
    if (mode === 'local') {
      try {
        localStorage.setItem(LEGACY_KEY, JSON.stringify(records));
        dirty = false;
        writeCache();
        return true;
      } catch {
        toast('تعذر الحفظ في المتصفح', 'error');
        return false;
      }
    }

    if (!connected || !fileHandle) {
      dirty = true;
      writeCache();
      if (!storedHandle) openConnectModal();
      toast('التعديل اتحفظ مؤقتًا على الجهاز — اضغط «إعادة ربط الملف» لكتابته في الملف', 'error');
      return false;
    }

    try {
      await writeToFile();
      dirty = false;
      writeCache();
      updateFileUI();
      return true;
    } catch (err) {
      dirty = true;
      writeCache();
      connected = false;
      updateFileUI();
      const msg =
        err && err.name === 'NotAllowedError'
          ? 'الصلاحية انتهت — اضغط «إعادة ربط الملف».'
          : 'تعذر الحفظ في ملف البيانات.';
      el.connectError.textContent = msg;
      openConnectModal();
      toast(msg, 'error');
      return false;
    }
  }

  async function reloadFromFile() {
    if (mode === 'local') {
      toast('الحفظ المحلي مفعّل', 'ok');
      return;
    }
    if (!connected || !fileHandle) {
      openConnectModal();
      return;
    }
    try {
      records = await readFromFile();
      dirty = false;
      writeCache();
      renderData();
      toast('تم التحديث من الملف', 'ok');
    } catch (err) {
      if (err && err.message === 'bad-json') {
        toast('ملف البيانات مش JSON صالح', 'error');
        return;
      }
      connected = false;
      updateFileUI();
      openConnectModal();
      toast('تعذر قراءة الملف', 'error');
    }
  }

  /* ================= واجهة حالة الملف ================= */
  function updateFileUI() {
    const name = fileHandle
      ? fileHandle.name
      : storedHandle
        ? storedHandle.name
        : '';

    el.filePill.classList.toggle('connected', connected);
    el.fileName.textContent = connected
      ? name || 'ملف JSON'
      : mode === 'local'
        ? 'حفظ المتصفح'
        : storedHandle
          ? storedHandle.name
          : 'مفيش ملف';

    el.fileBanner.hidden = connected || mode === 'local';
    if (!connected && mode === 'file') {
      el.bannerText.textContent = records.length
        ? 'بياناتك ظاهرة من آخر نسخة محفوظة — اضغط «إعادة ربط الملف» عشان التعديلات تتحفظ في الملف.'
        : 'مفيش ملف بيانات متصل — التعديلات مش هتتحفظ.';
    }

    el.connectFile.hidden = !connected;
    el.connectFile.textContent = connected ? '📄 ' + (name || 'ملف JSON') : '';

    const needReconnect = !!storedHandle && !connected;
    el.btnReconnect.hidden = !(supportsFS && needReconnect);
    el.btnNew.hidden = !supportsFS;
    el.btnOpen.hidden = !supportsFS;
    el.btnOpen.textContent = needReconnect ? 'اختيار ملف آخر' : 'فتح ملف موجود';
    el.btnLocal.hidden = supportsFS;

    el.connectNote.textContent = supportsFS
      ? 'الحفظ المباشر في ملف مدعوم في Chrome وEdge على الكمبيوتر.'
      : 'متصفحك لا يدعم الحفظ المباشر في الملفات. استخدم Chrome أو Edge، أو استخدم حفظ المتصفح.';
  }

  function openConnectModal() {
    updateFileUI();
    el.connectModal.hidden = false;
    document.body.style.overflow = 'hidden';
    const target = !el.btnReconnect.hidden
      ? el.btnReconnect
      : !el.btnNew.hidden
        ? el.btnNew
        : el.btnLocal;
    if (target && !target.hidden) target.focus();
  }

  function closeConnectModal() {
    el.connectModal.hidden = true;
    if (el.modal.hidden) document.body.style.overflow = '';
    el.connectError.textContent = '';
  }

  function useLocalMode() {
    mode = 'local';
    connected = false;
    records = readLegacy();
    closeConnectModal();
    updateFileUI();
    renderCurrent();
    toast('هنحفظ في متصفحك — استخدم تصدير JSON للنسخ الاحتياطي', 'ok');
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
    void el.password.offsetWidth;
    el.password.classList.add('shake');
    el.password.select();
  }

  async function initStorage() {
    // اعرض آخر نسخة محفوظة على الجهاز فورًا (تشتغل من غير نت)
    const cached = await readCache();
    if (cached.length && !records.length) {
      records = cached;
      updateFileUI();
      renderCurrent();
    }

    if (!supportsFS) {
      updateFileUI();
      renderCurrent();
      openConnectModal();
      return;
    }

    try {
      storedHandle = await idbGet(HANDLE_KEY);
    } catch {
      storedHandle = null;
    }

    if (!storedHandle) {
      updateFileUI();
      renderCurrent();
      openConnectModal();
      return;
    }

    let perm = 'prompt';
    try {
      perm = await storedHandle.queryPermission({ mode: 'readwrite' });
    } catch {
      perm = 'prompt';
    }

    if (perm === 'granted') {
      await attachHandle(storedHandle, { silent: true });
    } else {
      updateFileUI();
      renderCurrent();
      openConnectModal();
    }
  }

  async function enterApp(newRole) {
    role = newRole;
    el.roleBadge.textContent = newRole === 'notebook' ? '📓 وضع الدفتر' : '📊 وضع البيانات';
    el.roleBadge.classList.toggle('data', newRole === 'data');
    el.viewNotebook.hidden = newRole !== 'notebook';
    el.viewData.hidden = newRole !== 'data';
    el.loginScreen.classList.remove('active');
    el.appScreen.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'auto' });

    records = [];
    updateFileUI();
    renderCurrent();
    await initStorage();

    if (newRole === 'data' && connected) {
      try {
        records = await readFromFile();
        dirty = false;
        renderData();
      } catch {
        /* لو القراءة فشلت، سيب المعروض زي ما هو */
      }
    }
  }

  function logout() {
    clearSession();
    role = null;
    records = [];
    connected = false;
    dirty = false;
    fileHandle = null;
    resetForm();
    el.dSearch.value = '';
    el.nbSearch.value = '';
    closeConnectModal();
    closeModal();
    el.appScreen.classList.remove('active');
    el.loginScreen.classList.add('active');
    el.password.value = '';
    el.loginError.textContent = '';
    updateFileUI();
    el.password.focus();
  }

  function renderCurrent() {
    if (role === 'notebook') renderNotebook();
    else if (role === 'data') renderData();
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

  async function removeRecord(id) {
    const r = records.find((x) => x.id === id);
    if (!r) return;
    if (!storageReady()) return;
    if (!window.confirm(`تحذف السجل «${r.title}»؟`)) return;

    records = records.filter((x) => x.id !== id);
    if (editingId === id) resetForm();
    renderNotebook();
    const ok = await persist();
    toast(ok ? 'تم حذف السجل' : 'اتحذف من الشاشة — هيتحذف من الملف بعد «إعادة ربط الملف»', ok ? 'ok' : 'error');
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
    if (el.connectModal.hidden) document.body.style.overflow = '';
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

  el.filePill.addEventListener('click', openConnectModal);
  el.bannerConnect.addEventListener('click', openConnectModal);
  el.connectClose.addEventListener('click', closeConnectModal);
  el.connectModal.addEventListener('click', (e) => {
    if (e.target === el.connectModal) closeConnectModal();
  });
  el.btnNew.addEventListener('click', pickNewFile);
  el.btnOpen.addEventListener('click', pickExistingFile);
  el.btnReconnect.addEventListener('click', reconnectStored);
  el.btnLocal.addEventListener('click', useLocalMode);

  el.nbSearch.addEventListener('input', renderNotebook);

  el.recordForm.addEventListener('submit', async (e) => {
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
    if (!storageReady()) return;

    const now = Date.now();
    let message = 'تم حفظ السجل';

    if (editingId) {
      const idx = records.findIndex((r) => r.id === editingId);
      if (idx > -1) {
        records[idx] = { ...records[idx], title, category, content, updatedAt: now };
      }
      message = 'تم تحديث السجل';
    } else {
      records.unshift({
        id: uid(),
        title,
        category,
        content,
        createdAt: now,
        updatedAt: now,
      });
    }

    resetForm();
    renderNotebook();
    const ok = await persist();
    toast(ok ? message : 'اتحفظ مؤقتًا على الجهاز — اضغط «إعادة ربط الملف» لكتابته في الملف', ok ? 'ok' : 'error');
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
  el.refreshFile.addEventListener('click', reloadFromFile);
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
    if (e.key !== 'Escape') return;
    if (!el.connectModal.hidden) closeConnectModal();
    else if (!el.modal.hidden) closeModal();
  });

  // مزامنة وضع الحفظ المحلي بين التابات
  window.addEventListener('storage', (e) => {
    if (mode === 'local' && e.key === LEGACY_KEY && role) {
      records = readLegacy();
      renderCurrent();
    }
  });

  /* ================= بدء التشغيل ================= */
  const session = readSession();
  if (session) enterApp(session.role);
  else el.password.focus();
})();
