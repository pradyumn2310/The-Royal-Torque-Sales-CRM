// ---------- state ----------
let CURRENT_USER = null;
let CURRENT_VIEW = 'dashboard';
let LEADS_CACHE = [];
let STATUSES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Demo Booked', 'Demo Completed', 'No Show', 'Won', 'Lost'];
let REGIONS_CACHE = [];           // [{name, currency, symbol, locale}, ...]
let CURRENCY_BY_CODE = {};        // { INR: {symbol:'₹', locale:'en-IN'}, ... }
let DEFAULT_REGION = 'India';
let TEAM_USERS_CACHE = [];        // populated for admins: [{employeeId, name, role}, ...]
let EDITING_LEAD = null;          // lead object or null when adding
let PENDING_DASHBOARD_FILTER = null;


function normalizeExternalUrl(value) { if (!value) return ''; const raw=String(value).trim(); const candidate=/^https?:\/\//i.test(raw)?raw:`https://${raw}`; try { const u=new URL(candidate); return ['http:','https:'].includes(u.protocol)?u.href:''; } catch { return ''; } }
function displayHost(value) { try { return new URL(normalizeExternalUrl(value)).hostname.replace(/^www\./,''); } catch { return value || '—'; } }
function openDashboardFilter(kind,value) { PENDING_DASHBOARD_FILTER = { kind, value }; switchView(CURRENT_USER && CURRENT_USER.role === 'admin' ? 'allleads' : 'myleads'); }
async function renderProposalsView() {
  const root = $('#viewRoot');
  root.innerHTML = '<div class="empty">Loading proposal library…</div>';
  try {
    const data = await api('/api/proposals');
    root.innerHTML = '';
    const panel = el('div', { class: 'panel' }, [
      el('h2', {}, 'Shared Proposal Library'),
      el('p', { class: 'muted-copy' }, 'Upload proposal files so every signed-in team member can find and download them. Keep a separate backup of important files.'),
      el('form', { class: 'proposal-upload', onsubmit: async (e) => {
        e.preventDefault();
        const file = $('#proposalFile')?.files?.[0];
        if (!file) return toast('Choose a proposal file first', true);
        const form = new FormData(); form.append('file', file);
        try { await apiUpload('/api/proposals', form); toast('Proposal uploaded'); renderProposalsView(); }
        catch (err) { toast(err.message, true); }
      } }, [
        el('input', { id: 'proposalFile', type: 'file', required: 'required', accept: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt' }),
        el('button', { class: 'btn btn-gold', type: 'submit' }, 'Upload Proposal')
      ])
    ]);
    if (!data.proposals.length) panel.appendChild(el('div', { class: 'empty' }, 'No proposals uploaded yet.'));
    else {
      const rows = data.proposals.map((p) => {
        const actions = [el('a', { class: 'icon-btn', href: p.url }, 'Download')];
        if (CURRENT_USER.role === 'admin') actions.push(el('button', { class: 'icon-btn', onclick: async () => {
          if (!confirm(`Delete proposal "${p.filename}"?`)) return;
          try { await api('/api/proposals/' + p.id, { method: 'DELETE' }); toast('Proposal deleted'); renderProposalsView(); }
          catch (err) { toast(err.message, true); }
        } }, 'Delete'));
        return el('tr', {}, [el('td', {}, p.filename), el('td', {}, p.uploadedBy), el('td', {}, fmtDate(p.uploadedAt)), el('td', {}, el('div', { class: 'row-actions' }, actions))]);
      });
      panel.appendChild(el('table', {}, [
        el('thead', {}, el('tr', {}, ['File', 'Uploaded by', 'Date', 'Actions'].map(x => el('th', {}, x)))),
        el('tbody', {}, rows)
      ]));
    }
    root.appendChild(panel);
  } catch (err) { root.innerHTML = ''; root.appendChild(el('div', { class: 'empty' }, err.message)); }
}
async function renderCalendarView() {
  const root = $('#viewRoot');
  root.innerHTML = '<div class="empty">Loading calendar…</div>';
  const data = await api('/api/leads' + (CURRENT_USER.role === 'admin' ? '?all=1' : ''));
  const scheduled = data.leads.filter(l => l.demoDate).sort((a,b) => new Date(a.demoDate)-new Date(b.demoDate));
  root.innerHTML = '';
  const panel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Scheduled demos & follow-ups'),
    el('p', { class: 'muted-copy' }, 'Set a date on a lead record to have it appear here. This is a chronological schedule, not a synced external calendar.')
  ]);
  if (!scheduled.length) panel.appendChild(el('div', { class: 'empty' }, 'No demos or follow-ups scheduled. Open a lead and set its date.'));
  else {
    const rows = scheduled.map(l => el('tr', {}, [
      el('td', {}, new Date(l.demoDate).toLocaleString('en-IN')), el('td', {}, l.name),
      el('td', {}, l.company || '—'), el('td', {}, l.status),
      el('td', {}, el('button', { class: 'icon-btn', onclick: () => openLeadModal(l) }, 'Open lead'))
    ]));
    panel.appendChild(el('table', {}, [el('thead', {}, el('tr', {}, ['Date & time','Lead','Company','Status','Open'].map(x=>el('th',{},x)))), el('tbody', {}, rows)]));
  }
  root.appendChild(panel);
}

// ---------- small helpers ----------
function $(sel) { return document.querySelector(sel); }
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return n;
}
function fmtMoney(n, currencyCode) {
  const info = CURRENCY_BY_CODE[currencyCode] || { symbol: '', locale: 'en-US' };
  return info.symbol + Number(n || 0).toLocaleString(info.locale);
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(() => (t.className = 'toast'), 2600);
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
// Separate helper for file uploads: no Content-Type header, so the browser
// sets the correct multipart/form-data boundary itself.
async function apiUpload(path, formData) {
  const res = await fetch(path, { method: 'POST', body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

// ---------- boot ----------
async function boot() {
  try {
    const { user } = await api('/api/me');
    CURRENT_USER = user;
  } catch (e) {
    window.location.href = '/login.html';
    return;
  }
  $('#whoName').textContent = CURRENT_USER.name;
  $('#whoMeta').textContent = `ID ${CURRENT_USER.employeeId} · ${CURRENT_USER.role === 'admin' ? 'Admin' : 'Sales User'}`;

  const { regions, defaultRegion } = await api('/api/regions');
  REGIONS_CACHE = regions;
  DEFAULT_REGION = defaultRegion;
  CURRENCY_BY_CODE = {};
  regions.forEach((r) => (CURRENCY_BY_CODE[r.currency] = { symbol: r.symbol, locale: r.locale }));

  if (CURRENT_USER.role === 'admin') {
    $('#allLeadsNav').style.display = 'block';
    $('#uploadNav').style.display = 'block';
    $('#teamNav').style.display = 'block';
    try {
      const { users } = await api('/api/users');
      TEAM_USERS_CACHE = users;
    } catch (e) { /* non-fatal */ }
  }

  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
  $('#addLeadBtn').addEventListener('click', () => openLeadModal(null));

  switchView('dashboard');
}

function switchView(view) {
  CURRENT_VIEW = view;
  document.querySelectorAll('.nav-item[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  const titles = {
    dashboard: ['Dashboard', 'Overview of your sales pipeline'],
    proposals: ['Proposal Library', 'Shared proposals for the whole team'],
    calendar: ['Calendar', 'Scheduled demos and follow-ups'],
    myleads: ['My Leads', 'Leads you own and are working'],
    allleads: ['All Leads', 'Every lead across the whole team'],
    upload: ['Bulk Upload', 'Import leads from a CSV or Excel file and assign them'],
    team: ['Team / Admin', 'Create users and manage access'],
  };
  $('#viewTitle').textContent = titles[view][0];
  $('#viewSub').textContent = titles[view][1];
  $('#addLeadBtn').style.display = (view === 'team' || view === 'upload') ? 'none' : 'inline-block';

  if (view === 'dashboard') renderDashboard();
  else if (view === 'myleads') renderLeadsView(false);
  else if (view === 'allleads') renderLeadsView(true);
  else if (view === 'upload') renderUploadView();
  else if (view === 'team') renderTeam();
  else if (view === 'proposals') renderProposalsView();
  else if (view === 'calendar') renderCalendarView();
}

// ---------- dashboard ----------
async function renderDashboard() {
  const root = $('#viewRoot');
  root.innerHTML = '<div class="empty">Loading…</div>';
  const stats = await api('/api/stats');

  const cards = [['Total Leads', String(stats.total)]];
  if (stats.userCount !== undefined) cards.push(['Team Members', String(stats.userCount)]);

  const currencyLines = (obj) => {
    const entries = Object.entries(obj || {});
    if (!entries.length) return '—';
    return entries.map(([cur, val]) => fmtMoney(val, cur)).join('  ·  ');
  };

  const statGrid = el('div', { class: 'stat-grid' }, [
    ...cards.map(([label, value]) => el('div', { class: 'stat-card' }, [
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value),
    ])),
    el('div', { class: 'stat-card' }, [
      el('div', { class: 'label' }, 'Open Pipeline'),
      el('div', { class: 'value', style: 'font-size:1.1rem' }, currencyLines(stats.pipelineByCurrency)),
    ]),
    el('div', { class: 'stat-card' }, [
      el('div', { class: 'label' }, 'Won Value'),
      el('div', { class: 'value', style: 'font-size:1.1rem' }, currencyLines(stats.wonByCurrency)),
    ]),
  ]);

  const pipelinePanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Pipeline by Stage'),
    el('div', { class: 'stat-grid' },
      STATUSES.map((s) => el('div', { class: 'stat-card clickable-card', onclick: () => openDashboardFilter('status', s) }, [
        el('div', { class: 'label' }, s),
        el('div', { class: 'value' }, String(stats.byStatus[s] || 0)),
      ]))
    ),
  ]);

  const regionPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Leads by Region'),
    el('div', { class: 'stat-grid' },
      Object.entries(stats.byRegion || {}).length
        ? Object.entries(stats.byRegion).map(([region, count]) => el('div', { class: 'stat-card clickable-card', onclick: () => openDashboardFilter('region', region) }, [
            el('div', { class: 'label' }, region),
            el('div', { class: 'value' }, String(count)),
          ]))
        : [el('div', { class: 'empty' }, 'No leads yet')]
    ),
  ]);

  root.innerHTML = '';
  root.appendChild(statGrid);
  root.appendChild(pipelinePanel);
  root.appendChild(regionPanel);

  if (stats.byUser) {
    const rows = Object.entries(stats.byUser).map(([id, u]) =>
      el('tr', {}, [
        el('td', {}, u.name),
        el('td', {}, id),
        el('td', {}, String(u.count)),
        el('td', {}, String(u.won)),
      ])
    );
    const teamPanel = el('div', { class: 'panel' }, [
      el('h2', {}, 'Leads by Team Member'),
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Name'), el('th', {}, 'Employee ID'), el('th', {}, 'Leads'), el('th', {}, 'Won'),
        ])),
        el('tbody', {}, rows.length ? rows : [el('tr', {}, el('td', { colspan: '4', class: 'empty' }, 'No leads yet'))]),
      ]),
    ]);
    root.appendChild(teamPanel);
  }
}

// ---------- leads list ----------
async function renderLeadsView(all) {
  const root = $('#viewRoot');
  root.innerHTML = '<div class="empty">Loading…</div>';
  const data = await api('/api/leads' + (all ? '?all=1' : ''));
  LEADS_CACHE = data.leads;
  STATUSES = data.statuses;

  root.innerHTML = '';
  const panel = el('div', { class: 'panel' });

  const filterBarStyle = 'background:#1a1a20; border:1px solid #2a2a33; color:#fff; padding:9px 12px; border-radius:7px;';
  const filterBar = el('div', { style: 'display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;' }, [
    el('input', {
      id: 'searchBox', placeholder: 'Search by name, company, phone, email…',
      style: 'flex:1; min-width:200px; ' + filterBarStyle,
      oninput: () => renderLeadsTable(table, all),
    }),
    el('select', {
      id: 'statusFilter', style: filterBarStyle,
      onchange: () => renderLeadsTable(table, all),
    }, [el('option', { value: '' }, 'All statuses'), ...STATUSES.map((s) => el('option', { value: s }, s))]),
    el('select', {
      id: 'regionFilter', style: filterBarStyle,
      onchange: () => renderLeadsTable(table, all),
    }, [el('option', { value: '' }, 'All regions'), ...REGIONS_CACHE.map((r) => el('option', { value: r.name }, r.name))]),
  ]);

  const table = el('table', {}, []);
  panel.appendChild(filterBar);
  if (PENDING_DASHBOARD_FILTER) {
    const target = PENDING_DASHBOARD_FILTER.kind === 'status' ? filterBar.querySelector('#statusFilter') : filterBar.querySelector('#regionFilter');
    if (target) target.value = PENDING_DASHBOARD_FILTER.value;
    PENDING_DASHBOARD_FILTER = null;
  }
  panel.appendChild(table);
  root.appendChild(panel);
  renderLeadsTable(table, all);
}

function renderLeadsTable(table, all) {
  const q = ($('#searchBox')?.value || '').toLowerCase();
  const statusF = $('#statusFilter')?.value || '';
  const regionF = $('#regionFilter')?.value || '';
  const rows = LEADS_CACHE.filter((l) => {
    const matchQ = !q || [l.name, l.company, l.phone, l.email, l.website, l.linkedin, l.serviceInterest].join(' ').toLowerCase().includes(q);
    const matchS = !statusF || l.status === statusF;
    const matchR = !regionF || l.region === regionF;
    return matchQ && matchS && matchR;
  });

  table.innerHTML = '';
  const headCols = ['Name', 'Company Name', 'Website', 'Phone Number', 'Email', 'Region', 'Estimated Value', 'Lead Status', 'Convo', 'Actions'];
  table.appendChild(el('thead', {}, el('tr', {}, headCols.map((h) => el('th', {}, h)))));
  const tbody = el('tbody', {});
  if (!rows.length) tbody.appendChild(el('tr', {}, el('td', { colspan: String(headCols.length), class: 'empty' }, 'No leads found')));
  else {
    rows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    rows.forEach((l) => {
      const website = normalizeExternalUrl(l.website), linkedin = normalizeExternalUrl(l.linkedin);
      const nameLink = el('button', { class: 'lead-name-link', onclick: () => openLeadModal(l), title: 'Open lead details' }, l.name);
      const websiteCell = website ? el('a', { href: website, target: '_blank', rel: 'noopener noreferrer', class: 'table-link' }, displayHost(l.website)) : '—';
      const convo = el('div', { class: 'convo-cell' }, [l.email ? el('a', { href: `mailto:${l.email}`, class: 'table-link' }, 'Email') : '—', linkedin ? el('a', { href: linkedin, target: '_blank', rel: 'noopener noreferrer', class: 'table-link' }, 'LinkedIn') : null]);
      const cells = [
        el('td', {}, nameLink), el('td', {}, l.company || '—'), el('td', {}, websiteCell),
        el('td', {}, l.phone ? el('a', { href: `tel:${l.phone}`, class: 'table-link' }, l.phone) : '—'),
        el('td', {}, l.email ? el('a', { href: `mailto:${l.email}`, class: 'table-link' }, l.email) : '—'),
        el('td', {}, l.region || '—'), el('td', {}, fmtMoney(l.value, l.currency)),
        el('td', {}, el('span', { class: 'badge badge-' + l.status.replace(/\s+/g, '') }, l.status)), el('td', {}, convo),
        el('td', {}, el('div', { class: 'row-actions' }, [el('button', { class: 'icon-btn', onclick: () => openLeadModal(l) }, 'Edit'), el('button', { class: 'icon-btn', onclick: () => deleteLead(l) }, 'Delete')]))
      ];
      tbody.appendChild(el('tr', {}, cells));
    });
  }
  table.appendChild(tbody);
}

async function deleteLead(lead) {
  if (!confirm(`Delete lead "${lead.name}"? This cannot be undone.`)) return;
  try {
    await api('/api/leads/' + lead.id, { method: 'DELETE' });
    toast('Lead deleted');
    switchView(CURRENT_VIEW);
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- lead modal ----------
function openLeadModal(lead) {
  EDITING_LEAD = lead;
  const isEdit = !!lead;
  const isAdmin = CURRENT_USER.role === 'admin';
  const root = $('#modalRoot');

  const f = (name, value = '') => lead ? lead[name] : value;

  const assignField = isAdmin ? el('div', { class: 'field' }, [
    el('label', {}, 'Assign To'),
    el('select', { id: 'f_assign' },
      TEAM_USERS_CACHE.map((u) => el('option', { value: u.employeeId }, `${u.name} (${u.employeeId})`))
    ),
  ]) : null;

  const modal = el('div', { class: 'overlay', onclick: (e) => { if (e.target.classList.contains('overlay')) closeModal(); } }, [
    el('div', { class: 'modal' }, [
      el('h2', {}, isEdit ? 'Edit Lead' : 'Add New Lead'),
      el('div', { class: 'field' }, [el('label', {}, 'Lead / Contact Name *'), el('input', { id: 'f_name', value: f('name') })]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Company'), el('input', { id: 'f_company', value: f('company') })]),
        el('div', { class: 'field' }, [el('label', {}, 'Source'), el('input', { id: 'f_source', value: f('source'), placeholder: 'e.g. Referral, Website' })]),
      ]),
      el('div', { class: 'field' }, [el('label', {}, 'Website'), el('input', { id: 'f_website', value: f('website'), placeholder: 'https://example.com' })]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Phone'), el('input', { id: 'f_phone', value: f('phone') })]),
        el('div', { class: 'field' }, [el('label', {}, 'Email'), el('input', { id: 'f_email', type: 'email', value: f('email') })]),
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', {}, 'LinkedIn URL'), el('input', { id: 'f_linkedin', value: f('linkedin'), placeholder: 'https://linkedin.com/in/…' })]),
        el('div', { class: 'field' }, [el('label', {}, 'Service interested in collaborating on'), el('input', { id: 'f_service', value: f('serviceInterest'), placeholder: 'e.g. SEO, PPC, Web Development' })]),
      ]),
      el('div', { class: 'field' }, [el('label', {}, 'Demo / follow-up date'), el('input', { id: 'f_demo_date', type: 'datetime-local', value: f('demoDate') ? new Date(f('demoDate')).toISOString().slice(0,16) : '' })]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', {}, 'Region'),
          el('select', { id: 'f_region' }, REGIONS_CACHE.map((r) => el('option', { value: r.name }, r.name))),
        ]),
        el('div', { class: 'field' }, [
          el('label', {}, 'Status'),
          el('select', { id: 'f_status' }, STATUSES.map((s) => el('option', { value: s }, s))),
        ]),
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', { id: 'f_value_label' }, 'Deal Value'), el('input', { id: 'f_value', type: 'number', value: f('value', 0) })]),
        assignField,
      ]),
      el('div', { class: 'field' }, [el('label', {}, 'Notes'), el('textarea', { id: 'f_notes', rows: '3' }, f('notes'))]),
      isEdit ? el('div', { class: 'field' }, [
        el('label', {}, 'Add Activity Note'),
        el('input', { id: 'f_activity', placeholder: 'e.g. Called, left voicemail…' }),
      ]) : null,
      isEdit && lead.activity?.length ? el('ul', { class: 'activity-list' },
        [...lead.activity].reverse().map((a) => el('li', {}, [el('b', {}, a.by + ': '), a.note, ' — ', fmtDate(a.date)]))
      ) : null,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn btn-ghost', onclick: closeModal }, 'Cancel'),
        el('button', { class: 'btn btn-gold', onclick: saveLead }, isEdit ? 'Save Changes' : 'Add Lead'),
      ]),
    ]),
  ]);
  root.innerHTML = '';
  root.appendChild(modal);
  $('#f_status').value = f('status', 'New');
  $('#f_region').value = f('region', DEFAULT_REGION);
  updateValueLabel();
  $('#f_region').addEventListener('change', updateValueLabel);
  if (isAdmin) {
    $('#f_assign').value = isEdit ? lead.ownerId : CURRENT_USER.employeeId;
  }
}
function updateValueLabel() {
  const regionName = $('#f_region')?.value;
  const region = REGIONS_CACHE.find((r) => r.name === regionName);
  const lbl = $('#f_value_label');
  if (lbl && region) lbl.textContent = `Deal Value (${region.currency})`;
}
function closeModal() {
  $('#modalRoot').innerHTML = '';
  EDITING_LEAD = null;
}

async function saveLead() {
  const payload = {
    name: $('#f_name').value.trim(),
    company: $('#f_company').value.trim(),
    source: $('#f_source').value.trim(),
    website: $('#f_website').value.trim(),
    linkedin: $('#f_linkedin').value.trim(),
    serviceInterest: $('#f_service').value.trim(),
    demoDate: $('#f_demo_date').value ? new Date($('#f_demo_date').value).toISOString() : null,
    phone: $('#f_phone').value.trim(),
    email: $('#f_email').value.trim(),
    status: $('#f_status').value,
    value: $('#f_value').value,
    notes: $('#f_notes').value.trim(),
    region: $('#f_region').value,
  };
  if (CURRENT_USER.role === 'admin' && $('#f_assign')) {
    payload.assignTo = $('#f_assign').value;
  }
  if (!payload.name) return toast('Lead name is required', true);

  try {
    if (EDITING_LEAD) {
      await api('/api/leads/' + EDITING_LEAD.id, { method: 'PUT', body: JSON.stringify(payload) });
      const noteEl = $('#f_activity');
      if (noteEl && noteEl.value.trim()) {
        await api('/api/leads/' + EDITING_LEAD.id + '/activity', { method: 'POST', body: JSON.stringify({ note: noteEl.value.trim() }) });
      }
      toast('Lead updated');
    } else {
      await api('/api/leads', { method: 'POST', body: JSON.stringify(payload) });
      toast('Lead added');
    }
    closeModal();
    switchView(CURRENT_VIEW);
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- bulk upload ----------
function renderUploadView() {
  const root = $('#viewRoot');
  if (CURRENT_USER.role !== 'admin') {
    root.innerHTML = '<div class="empty">Admin access only.</div>';
    return;
  }
  root.innerHTML = '';

  const panel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Import Leads from CSV / Excel'),
    el('p', { style: 'color:var(--muted); font-size:.85rem; margin:-6px 0 16px;' },
      'Upload a .csv or .xlsx file of scraped leads. Expected columns (any order, header names are flexible): Name (required), Company, Phone, Email, Source, Notes, Value, and optionally Region (if a row has its own Region column, it overrides the one picked below).'),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [
        el('label', {}, 'Region for this batch'),
        el('select', { id: 'up_region' }, REGIONS_CACHE.map((r) => el('option', { value: r.name }, r.name))),
      ]),
      el('div', { class: 'field' }, [
        el('label', {}, 'Assign To'),
        el('select', { id: 'up_assign' },
          TEAM_USERS_CACHE.map((u) => el('option', { value: u.employeeId }, `${u.name} (${u.employeeId})`))
        ),
      ]),
    ]),
    el('div', { class: 'upload-box' }, [
      el('input', { id: 'up_file', type: 'file', accept: '.csv,.xlsx,.xls' }),
    ]),
    el('button', { class: 'btn btn-gold', style: 'margin-top:16px;', onclick: doBulkUpload }, '📤 Upload & Import'),
    el('div', { id: 'up_result', class: 'upload-result' }),
  ]);
  root.appendChild(panel);
  $('#up_region').value = DEFAULT_REGION;
}

async function doBulkUpload() {
  const fileInput = $('#up_file');
  const resultBox = $('#up_result');
  if (!fileInput.files.length) {
    return toast('Choose a CSV or Excel file first', true);
  }
  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  fd.append('region', $('#up_region').value);
  fd.append('assignTo', $('#up_assign').value);

  resultBox.innerHTML = '';
  resultBox.appendChild(el('div', {}, 'Uploading and importing…'));
  try {
    const data = await apiUpload('/api/leads/bulk-upload', fd);
    resultBox.innerHTML = '';
    resultBox.appendChild(el('div', { class: 'ok-line' }, `✓ Imported ${data.inserted} of ${data.total} rows.`));
    if (data.skipped && data.skipped.length) {
      resultBox.appendChild(el('div', {}, `${data.skipped.length} row(s) skipped:`));
      resultBox.appendChild(el('ul', { class: 'skip-list' },
        data.skipped.map((s) => el('li', {}, `Row ${s.row}: ${s.reason}`))
      ));
    }
    toast(`Imported ${data.inserted} leads`);
    fileInput.value = '';
  } catch (e) {
    resultBox.innerHTML = '';
    toast(e.message, true);
  }
}

// ---------- team / admin ----------
async function renderTeam() {
  const root = $('#viewRoot');
  root.innerHTML = '<div class="empty">Loading…</div>';
  if (CURRENT_USER.role !== 'admin') {
    root.innerHTML = '<div class="empty">Admin access only.</div>';
    return;
  }
  const { users } = await api('/api/users');
  TEAM_USERS_CACHE = users; // keep cache fresh for the lead modal / upload view
  root.innerHTML = '';

  const addPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Create New User'),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, 'Employee ID'), el('input', { id: 'u_id', placeholder: 'e.g. 2311' })]),
      el('div', { class: 'field' }, [el('label', {}, 'Full Name'), el('input', { id: 'u_name', placeholder: 'e.g. Rahul Mehta' })]),
    ]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', {}, 'Password'), el('input', { id: 'u_pass', type: 'text', placeholder: 'Set a password' })]),
      el('div', { class: 'field' }, [
        el('label', {}, 'Role'),
        el('select', { id: 'u_role' }, [el('option', { value: 'user' }, 'Sales User'), el('option', { value: 'admin' }, 'Admin')]),
      ]),
    ]),
    el('button', { class: 'btn btn-gold', onclick: createUser }, '+ Create User'),
  ]);

  const tbody = el('tbody', {}, users.map((u) =>
    el('tr', {}, [
      el('td', {}, u.employeeId),
      el('td', {}, u.name),
      el('td', {}, el('span', { class: 'badge ' + (u.role === 'admin' ? 'badge-Won' : 'badge-New') }, u.role === 'admin' ? 'Admin' : 'Sales User')),
      el('td', {}, fmtDate(u.createdAt)),
      el('td', {}, u.employeeId === CURRENT_USER.employeeId ? '—' :
        el('button', { class: 'icon-btn', onclick: () => deleteUser(u) }, 'Remove')),
    ])
  ));

  const listPanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Team Members'),
    el('table', {}, [
      el('thead', {}, el('tr', {}, ['Employee ID', 'Name', 'Role', 'Added', ''].map((h) => el('th', {}, h)))),
      tbody,
    ]),
  ]);

  root.appendChild(addPanel);
  root.appendChild(listPanel);
}

async function createUser() {
  const payload = {
    employeeId: $('#u_id').value.trim(),
    name: $('#u_name').value.trim(),
    password: $('#u_pass').value,
    role: $('#u_role').value,
  };
  if (!payload.employeeId || !payload.name || !payload.password) {
    return toast('Employee ID, name and password are all required', true);
  }
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    toast('User created');
    renderTeam();
  } catch (e) {
    toast(e.message, true);
  }
}
async function deleteUser(u) {
  if (!confirm(`Remove ${u.name} (${u.employeeId})? Their past leads stay on record.`)) return;
  try {
    await api('/api/users/' + u.employeeId, { method: 'DELETE' });
    toast('User removed');
    renderTeam();
  } catch (e) {
    toast(e.message, true);
  }
}

boot();
