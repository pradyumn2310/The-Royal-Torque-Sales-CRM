require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'royal-torque-crm-local-secret-change-if-you-want',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 hours
  })
);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect(req.session.user ? '/dashboard.html' : '/login.html');
});

// ---------- helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
function publicUser(u) {
  return { employeeId: u.employee_id, name: u.name, role: u.role, createdAt: u.created_at };
}
function publicLead(l) {
  return {
    id: l.id,
    ownerId: l.owner_id,
    ownerName: l.owner_name,
    name: l.name,
    company: l.company,
    phone: l.phone,
    email: l.email,
    status: l.status,
    value: Number(l.value),
    source: l.source,
    notes: l.notes,
    activity: l.activity,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };
}
function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });
}

// ---------- auth ----------
app.post('/api/login', asyncRoute(async (req, res) => {
  const { employeeId, password } = req.body || {};
  if (!employeeId || !password) {
    return res.status(400).json({ error: 'Employee ID and password are required' });
  }
  const user = await db.getUserByEmployeeId(String(employeeId).trim());
  if (!user) return res.status(401).json({ error: 'Invalid employee ID or password' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid employee ID or password' });

  req.session.user = { employeeId: user.employee_id, name: user.name, role: user.role };
  res.json({ user: publicUser(user) });
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// ---------- admin: user management ----------
app.get('/api/users', requireAdmin, asyncRoute(async (req, res) => {
  const users = await db.listUsers();
  res.json({ users: users.map(publicUser) });
}));

app.post('/api/users', requireAdmin, asyncRoute(async (req, res) => {
  const { employeeId, name, password, role } = req.body || {};
  if (!employeeId || !name || !password) {
    return res.status(400).json({ error: 'Employee ID, name and password are required' });
  }
  const cleanRole = role === 'admin' ? 'admin' : 'user';
  const existing = await db.getUserByEmployeeId(String(employeeId).trim());
  if (existing) return res.status(409).json({ error: 'That employee ID already exists' });

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = await db.createUser({
    employeeId: String(employeeId).trim(),
    name: name.trim(),
    passwordHash,
    role: cleanRole,
  });
  res.status(201).json({ user: publicUser(newUser) });
}));

app.delete('/api/users/:employeeId', requireAdmin, asyncRoute(async (req, res) => {
  const { employeeId } = req.params;
  if (employeeId === req.session.user.employeeId) {
    return res.status(400).json({ error: "You can't delete your own account while logged in" });
  }
  const ok = await db.deleteUser(employeeId);
  if (!ok) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
}));

// ---------- leads ----------
const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'];

app.get('/api/leads', requireAuth, asyncRoute(async (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const wantAll = req.query.all === '1' && isAdmin;
  const leads = await db.listLeads({ ownerId: req.session.user.employeeId, all: wantAll });
  res.json({ leads: leads.map(publicLead), statuses: LEAD_STATUSES });
}));

app.post('/api/leads', requireAuth, asyncRoute(async (req, res) => {
  const { name, company, phone, email, status, value, source, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Lead name is required' });

  const lead = await db.createLead({
    ownerId: req.session.user.employeeId,
    ownerName: req.session.user.name,
    name: name.trim(),
    company: (company || '').trim(),
    phone: (phone || '').trim(),
    email: (email || '').trim(),
    status: LEAD_STATUSES.includes(status) ? status : 'New',
    value: Number(value) || 0,
    source: (source || '').trim(),
    notes: (notes || '').trim(),
    activity: [{ date: new Date().toISOString(), by: req.session.user.name, note: 'Lead created' }],
  });
  res.status(201).json({ lead: publicLead(lead) });
}));

function canEditLead(req, lead) {
  return req.session.user.role === 'admin' || lead.owner_id === req.session.user.employeeId;
}

app.put('/api/leads/:id', requireAuth, asyncRoute(async (req, res) => {
  const existing = await db.getLead(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });
  if (!canEditLead(req, existing)) return res.status(403).json({ error: 'Not your lead' });

  const { name, company, phone, email, status, value, source, notes } = req.body || {};
  const fields = {};
  if (name !== undefined) fields.name = name.trim();
  if (company !== undefined) fields.company = company.trim();
  if (phone !== undefined) fields.phone = phone.trim();
  if (email !== undefined) fields.email = email.trim();
  if (value !== undefined) fields.value = Number(value) || 0;
  if (source !== undefined) fields.source = source.trim();
  if (notes !== undefined) fields.notes = notes.trim();

  let activity = existing.activity || [];
  if (status !== undefined && LEAD_STATUSES.includes(status) && status !== existing.status) {
    activity = [...activity, { date: new Date().toISOString(), by: req.session.user.name, note: `Status changed: ${existing.status} → ${status}` }];
    fields.status = status;
  }
  fields.activity = activity;

  const lead = await db.updateLead(req.params.id, fields);
  res.json({ lead: publicLead(lead) });
}));

app.post('/api/leads/:id/activity', requireAuth, asyncRoute(async (req, res) => {
  const existing = await db.getLead(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });
  if (!canEditLead(req, existing)) return res.status(403).json({ error: 'Not your lead' });
  const { note } = req.body || {};
  if (!note || !note.trim()) return res.status(400).json({ error: 'Note text required' });

  const activity = [...(existing.activity || []), { date: new Date().toISOString(), by: req.session.user.name, note: note.trim() }];
  const lead = await db.updateLead(req.params.id, { activity });
  res.json({ lead: publicLead(lead) });
}));

app.delete('/api/leads/:id', requireAuth, asyncRoute(async (req, res) => {
  const existing = await db.getLead(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lead not found' });
  if (!canEditLead(req, existing)) return res.status(403).json({ error: 'Not your lead' });
  await db.deleteLead(req.params.id);
  res.json({ ok: true });
}));

// ---------- dashboard stats ----------
app.get('/api/stats', requireAuth, asyncRoute(async (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const leads = await db.listLeads({ ownerId: req.session.user.employeeId, all: isAdmin });

  const byStatus = {};
  LEAD_STATUSES.forEach((s) => (byStatus[s] = 0));
  let pipelineValue = 0;
  let wonValue = 0;
  leads.forEach((l) => {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    const v = Number(l.value);
    if (l.status === 'Won') wonValue += v;
    else if (l.status !== 'Lost') pipelineValue += v;
  });

  let byUser = null;
  let userCount;
  if (isAdmin) {
    const users = await db.listUsers();
    userCount = users.length;
    byUser = {};
    users.forEach((u) => (byUser[u.employee_id] = { name: u.name, count: 0, won: 0 }));
    leads.forEach((l) => {
      if (!byUser[l.owner_id]) byUser[l.owner_id] = { name: l.owner_name, count: 0, won: 0 };
      byUser[l.owner_id].count += 1;
      if (l.status === 'Won') byUser[l.owner_id].won += 1;
    });
  }

  res.json({ total: leads.length, byStatus, pipelineValue, wonValue, byUser, userCount });
}));

// ---------- boot ----------
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log('');
      console.log('  The Royal Torque — Sales CRM');
      console.log(`  Running on port ${PORT}`);
      console.log('');
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
