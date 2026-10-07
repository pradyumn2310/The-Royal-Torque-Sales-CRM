// ---------- state ----------
let CURRENT_USER = null;
let CURRENT_VIEW = 'dashboard';
let LEADS_CACHE = [];
let STATUSES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'];
let EDITING_LEAD = null; // lead object or null when adding

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
function fmtMoney(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
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
  if (CURRENT_USER.role === 'admin') {
    $('#allLeadsNav').style.display = 'block';
    $('#teamNav').style.display = 'block';
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
    myleads: ['My Leads', 'Leads you own and are working'],
    allleads: ['All Leads', 'Every lead across the whole team'],
    team: ['Team / Admin', 'Create users and manage access'],
  };
  $('#viewTitle').textContent = titles[view][0];
  $('#viewSub').textContent = titles[view][1];
  $('#addLeadBtn').style.display = view === 'team' ? 'none' : 'inline-block';

  if (view === 'dashboard') renderDashboard();
  else if (view === 'myleads') renderLeadsView(false);
  else if (view === 'allleads') renderLeadsView(true);
  else if (view === 'team') renderTeam();
}

// ---------- dashboard ----------
async function renderDashboard() {
  const root = $('#viewRoot');
  root.innerHTML = '<div class="empty">Loading…</div>';
  const stats = await api('/api/stats');

  const cards = [
    ['Total Leads', stats.total],
    ['Open Pipeline', fmtMoney(stats.pipelineValue)],
    ['Won Value', fmtMoney(stats.wonValue)],
  ];
  if (stats.userCount !== undefined) cards.push(['Team Members', stats.userCount]);

  const statGrid = el('div', { class: 'stat-grid' },
    cards.map(([label, value]) => el('div', { class: 'stat-card' }, [
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, String(value)),
    ]))
  );

  const pipelinePanel = el('div', { class: 'panel' }, [
    el('h2', {}, 'Pipeline by Stage'),
    el('div', { class: 'stat-grid' },
      STATUSES.map((s) => el('div', { class: 'stat-card' }, [
        el('div', { class: 'label' }, s),
        el('div', { class: 'value' }, String(stats.byStatus[s] || 0)),
      ]))
    ),
  ]);

  root.innerHTML = '';
  root.appendChild(statGrid);
  root.appendChild(pipelinePanel);

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

  const filterBar = el('div', { style: 'display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;' }, [
    el('input', {
      id: 'searchBox', placeholder: 'Search by name, company, phone, email…',
      style: 'flex:1; min-width:200px; background:#1a1a20; border:1px solid #2a2a33; color:#fff; padding:9px 12px; border-radius:7px;',
      oninput: () => renderLeadsTable(table, all),
    }),
    el('select', {
      id: 'statusFilter',
      style: 'background:#1a1a20; border:1px solid #2a2a33; color:#fff; padding:9px 12px; border-radius:7px;',
      onchange: () => renderLeadsTable(table, all),
    }, [el('option', { value: '' }, 'All statuses'), ...STATUSES.map((s) => el('option', { value: s }, s))]),
  ]);

  const table = el('table', {}, []);
  panel.appendChild(filterBar);
  panel.appendChild(table);
  root.appendChild(panel);
  renderLeadsTable(table, all);
}

function renderLeadsTable(table, all) {
  const q = ($('#searchBox')?.value || '').toLowerCase();
  const statusF = $('#statusFilter')?.value || '';
  const rows = LEADS_CACHE.filter((l) => {
    const matchQ = !q || [l.name, l.company, l.phone, l.email].join(' ').toLowerCase().includes(q);
    const matchS = !statusF || l.status === statusF;
    return matchQ && matchS;
  });

  table.innerHTML = '';
  const headCols = ['Name', 'Company', 'Contact', 'Status', 'Value'];
  if (all) headCols.push('Owner');
  headCols.push('Actions');

  table.appendChild(el('thead', {}, el('tr', {}, headCols.map((h) => el('th', {}, h)))));

  const tbody = el('tbody', {});
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: String(headCols.length), class: 'empty' }, 'No leads found')));
  } else {
    rows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    rows.forEach((l) => {
      const cells = [
        el('td', {}, el('b', {}, l.name)),
        el('td', {}, l.company || '—'),
        el('td', {}, [l.phone, l.email].filter(Boolean).join(' / ') || '—'),
        el('td', {}, el('span', { class: 'badge badge-' + l.status }, l.status)),
        el('td', {}, fmtMoney(l.value)),
      ];
      if (all) cells.push(el('td', {}, l.ownerName));
      cells.push(el('td', {}, el('div', { class: 'row-actions' }, [
        el('button', { class: 'icon-btn', onclick: () => openLeadModal(l) }, 'Open'),
        el('button', { class: 'icon-btn', onclick: () => deleteLead(l) }, 'Delete'),
      ])));
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
  const root = $('#modalRoot');

  const f = (name, value = '') => lead ? lead[name] : value;

  const modal = el('div', { class: 'overlay', onclick: (e) => { if (e.target.classList.contains('overlay')) closeModal(); } }, [
    el('div', { class: 'modal' }, [
      el('h2', {}, isEdit ? 'Edit Lead' : 'Add New Lead'),
      el('div', { class: 'field' }, [el('label', {}, 'Lead / Contact Name *'), el('input', { id: 'f_name', value: f('name') })]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Company'), el('input', { id: 'f_company', value: f('company') })]),
        el('div', { class: 'field' }, [el('label', {}, 'Source'), el('input', { id: 'f_source', value: f('source'), placeholder: 'e.g. Referral, Website' })]),
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Phone'), el('input', { id: 'f_phone', value: f('phone') })]),
        el('div', { class: 'field' }, [el('label', {}, 'Email'), el('input', { id: 'f_email', value: f('email') })]),
      ]),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [
          el('label', {}, 'Status'),
          el('select', { id: 'f_status' }, STATUSES.map((s) => el('option', { value: s }, s))),
        ]),
        el('div', { class: 'field' }, [el('label', {}, 'Deal Value (₹)'), el('input', { id: 'f_value', type: 'number', value: f('value', 0) })]),
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
  $('#f_status').value = f('status', 'New'); // ensure correct option is selected for edits
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
    phone: $('#f_phone').value.trim(),
    email: $('#f_email').value.trim(),
    status: $('#f_status').value,
    value: $('#f_value').value,
    notes: $('#f_notes').value.trim(),
  };
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

// ---------- team / admin ----------
async function renderTeam() {
  const root = $('#viewRoot');
  root.innerHTML = '<div class="empty">Loading…</div>';
  if (CURRENT_USER.role !== 'admin') {
    root.innerHTML = '<div class="empty">Admin access only.</div>';
    return;
  }
  const { users } = await api('/api/users');
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
