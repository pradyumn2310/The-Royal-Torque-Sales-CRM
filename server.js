require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('./db');
const { REGIONS, DEFAULT_REGION, regionByName, currencyForRegion, isValidRegion } = require('./regions');

const app = express();
const PORT = process.env.PORT || 4000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }); // 8MB cap

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
    region: l.region,
    currency: l.currency,
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

// ---------- regions / currency ----------
app.get('/api/regions', requireAuth, (req, res) => {
  res.json({ regions: REGIONS, defaultRegion: DEFAULT_REGION });
});

// ---------- leads ----------
const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'];

app.get('/api/leads', requireAuth, asyncRoute(async (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const wantAll = req.query.all === '1' && isAdmin;
  let leads = await db.listLeads({ ownerId: req.session.user.employeeId, all: wantAll });
  if (req.query.region) {
    leads = leads.filter((l) => l.region === req.query.region);
  }
  res.json({ leads: leads.map(publicLead), statuses: LEAD_STATUSES, regions: REGIONS });
}));

app.post('/api/leads', requireAuth, asyncRoute(async (req, res) => {
  const { name, company, phone, email, status, value, source, notes, region, assignTo } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Lead name is required' });

  const isAdmin = req.session.user.role === 'admin';
  let ownerId = req.session.user.employeeId;
  let ownerName = req.session.user.name;
  // Only an admin may hand a lead to someone else; anyone else's leads stay theirs.
  if (isAdmin && assignTo && assignTo !== ownerId) {
    const target = await db.getUserByEmployeeId(String(assignTo).trim());
    if (!target) return res.status(400).json({ error: 'That team member does not exist' });
    ownerId = target.employee_id;
    ownerName = target.name;
  }

  const finalRegion = isValidRegion(region) ? region : DEFAULT_REGION;

  const lead = await db.createLead({
    ownerId,
    ownerName,
    name: name.trim(),
    company: (company || '').trim(),
    phone: (phone || '').trim(),
    email: (email || '').trim(),
    status: LEAD_STATUSES.includes(status) ? status : 'New',
    value: Number(value) || 0,
    source: (source || '').trim(),
    notes: (notes || '').trim(),
    region: finalRegion,
    currency: currencyForRegion(finalRegion),
    activity: [{
      date: new Date().toISOString(),
      by: req.session.user.name,
      note: ownerId !== req.session.user.employeeId ? `Lead created and assigned to ${ownerName}` : 'Lead created',
    }],
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

  const isAdmin = req.session.user.role === 'admin';
  const { name, company, phone, email, status, value, source, notes, region, assignTo } = req.body || {};
  const fields = {};
  if (name !== undefined) fields.name = name.trim();
  if (company !== undefined) fields.company = company.trim();
  if (phone !== undefined) fields.phone = phone.trim();
  if (email !== undefined) fields.email = email.trim();
  if (value !== undefined) fields.value = Number(value) || 0;
  if (source !== undefined) fields.source = source.trim();
  if (notes !== undefined) fields.notes = notes.trim();

  let activity = existing.activity || [];

  if (region !== undefined && isValidRegion(region) && region !== existing.region) {
    fields.region = region;
    fields.currency = currencyForRegion(region);
    activity = [...activity, { date: new Date().toISOString(), by: req.session.user.name, note: `Region changed: ${existing.region} → ${region}` }];
  }

  // Only an admin can reassign a lead to a different team member.
  if (isAdmin && assignTo !== undefined && assignTo && assignTo !== existing.owner_id) {
    const target = await db.getUserByEmployeeId(String(assignTo).trim());
    if (!target) return res.status(400).json({ error: 'That team member does not exist' });
    fields.owner_id = target.employee_id;
    fields.owner_name = target.name;
    activity = [...activity, { date: new Date().toISOString(), by: req.session.user.name, note: `Reassigned: ${existing.owner_name} → ${target.name}` }];
  }

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

// ---------- bulk lead upload (CSV / XLSX) ----------
// Accepts a spreadsheet of scraped leads, a region to apply (used for every
// row unless that row has its own "region" column), and an employee ID to
// assign the whole batch to. Admin only.
const BULK_COLUMN_ALIASES = {
  name: ['name', 'lead name', 'contact', 'contact name', 'full name'],
  company: ['company', 'company name', 'business', 'business name', 'organisation', 'organization'],
  phone: ['phone', 'phone number', 'mobile', 'contact number', 'whatsapp'],
  email: ['email', 'email address', 'e-mail'],
  source: ['source', 'lead source'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments'],
  value: ['value', 'deal value', 'amount', 'budget'],
  region: ['region', 'country', 'location'],
};
function findColumn(rowKeys, aliases) {
  const lowerMap = {};
  rowKeys.forEach((k) => (lowerMap[k.trim().toLowerCase()] = k));
  for (const alias of aliases) {
    if (lowerMap[alias]) return lowerMap[alias];
  }
  return null;
}

app.post('/api/leads/bulk-upload', requireAdmin, upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { region: batchRegion, assignTo } = req.body || {};
  if (!assignTo) return res.status(400).json({ error: 'Choose a team member to assign these leads to' });

  const target = await db.getUserByEmployeeId(String(assignTo).trim());
  if (!target) return res.status(400).json({ error: 'That team member does not exist' });

  const defaultRegion = isValidRegion(batchRegion) ? batchRegion : DEFAULT_REGION;

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch (e) {
    return res.status(400).json({ error: 'Could not read that file. Please upload a valid .csv or .xlsx file.' });
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!rows.length) return res.status(400).json({ error: 'That file has no rows to import' });

  const rowKeys = Object.keys(rows[0]);
  const colMap = {};
  for (const field of Object.keys(BULK_COLUMN_ALIASES)) {
    colMap[field] = findColumn(rowKeys, BULK_COLUMN_ALIASES[field]);
  }
  if (!colMap.name) {
    return res.status(400).json({ error: 'Could not find a "Name" column in that file. Expected a header like "Name", "Lead Name" or "Contact Name".' });
  }

  const toImport = [];
  const skipped = [];
  rows.forEach((row, idx) => {
    const name = colMap.name ? String(row[colMap.name] || '').trim() : '';
    if (!name) {
      skipped.push({ row: idx + 2, reason: 'Missing name' }); // +2: header row + 1-indexing
      return;
    }
    const rowRegionRaw = colMap.region ? String(row[colMap.region] || '').trim() : '';
    const rowRegion = isValidRegion(rowRegionRaw) ? rowRegionRaw : defaultRegion;

    toImport.push({
      ownerId: target.employee_id,
      ownerName: target.name,
      name,
      company: colMap.company ? String(row[colMap.company] || '').trim() : '',
      phone: colMap.phone ? String(row[colMap.phone] || '').trim() : '',
      email: colMap.email ? String(row[colMap.email] || '').trim() : '',
      status: 'New',
      value: colMap.value ? Number(row[colMap.value]) || 0 : 0,
      source: colMap.source ? String(row[colMap.source] || '').trim() : 'Bulk upload',
      notes: colMap.notes ? String(row[colMap.notes] || '').trim() : '',
      region: rowRegion,
      currency: currencyForRegion(rowRegion),
      activity: [{
        date: new Date().toISOString(),
        by: req.session.user.name,
        note: `Imported from file and assigned to ${target.name}`,
      }],
    });
  });

  if (!toImport.length) {
    return res.status(400).json({ error: 'No valid rows to import', skipped });
  }

  const inserted = await db.createLeadsBulk(toImport);
  res.status(201).json({ inserted: inserted.length, skipped, total: rows.length });
}));

// ---------- dashboard stats ----------
app.get('/api/stats', requireAuth, asyncRoute(async (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const leads = await db.listLeads({ ownerId: req.session.user.employeeId, all: isAdmin });

  const byStatus = {};
  LEAD_STATUSES.forEach((s) => (byStatus[s] = 0));
  // Values are grouped by currency rather than blended into one number —
  // adding ₹ and $ together would produce a meaningless total.
  const pipelineByCurrency = {};
  const wonByCurrency = {};
  const byRegion = {};
  leads.forEach((l) => {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    byRegion[l.region] = (byRegion[l.region] || 0) + 1;
    const v = Number(l.value);
    const cur = l.currency || 'INR';
    if (l.status === 'Won') {
      wonByCurrency[cur] = (wonByCurrency[cur] || 0) + v;
    } else if (l.status !== 'Lost') {
      pipelineByCurrency[cur] = (pipelineByCurrency[cur] || 0) + v;
    }
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

  res.json({ total: leads.length, byStatus, pipelineByCurrency, wonByCurrency, byRegion, byUser, userCount });
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
