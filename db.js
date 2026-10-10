// Postgres-backed storage (Neon free tier, or any Postgres you point it at).
// Reads the connection string from the DATABASE_URL environment variable.
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  console.error('Set it to your Neon (or other Postgres) connection string before starting the server.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      employee_id   TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id    TEXT NOT NULL REFERENCES users(employee_id) ON DELETE CASCADE,
      owner_name  TEXT NOT NULL,
      name        TEXT NOT NULL,
      company     TEXT DEFAULT '',
      phone       TEXT DEFAULT '',
      email       TEXT DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'New',
      value       NUMERIC NOT NULL DEFAULT 0,
      source      TEXT DEFAULT '',
      notes       TEXT DEFAULT '',
      activity    JSONB NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // gen_random_uuid() needs pgcrypto on some Postgres versions (Neon has it built in,
  // but this is a harmless no-op if it's already available).
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`).catch(() => {});

  // Migration: add region/currency to leads created by an earlier version of this app.
  // Safe to run every boot — IF NOT EXISTS makes it a no-op once applied.
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'India';`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';`);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const hash = bcrypt.hashSync('Princy!@_2123', 10);
    await pool.query(
      'INSERT INTO users (employee_id, name, password_hash, role) VALUES ($1,$2,$3,$4)',
      ['2310', 'Admin', hash, 'admin']
    );
    console.log('Seeded initial admin user 2310.');
  }
}

// ---------- users ----------
async function getUserByEmployeeId(employeeId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE employee_id = $1', [employeeId]);
  return rows[0] || null;
}
async function listUsers() {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
  return rows;
}
async function createUser({ employeeId, name, passwordHash, role }) {
  const { rows } = await pool.query(
    'INSERT INTO users (employee_id, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING *',
    [employeeId, name, passwordHash, role]
  );
  return rows[0];
}
async function deleteUser(employeeId) {
  const { rowCount } = await pool.query('DELETE FROM users WHERE employee_id = $1', [employeeId]);
  return rowCount > 0;
}

// ---------- leads ----------
async function listLeads({ ownerId, all }) {
  if (all) {
    const { rows } = await pool.query('SELECT * FROM leads ORDER BY updated_at DESC');
    return rows;
  }
  const { rows } = await pool.query('SELECT * FROM leads WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId]);
  return rows;
}
async function getLead(id) {
  const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
  return rows[0] || null;
}
async function createLead(lead) {
  const { rows } = await pool.query(
    `INSERT INTO leads (owner_id, owner_name, name, company, phone, email, status, value, source, notes, activity, region, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      lead.ownerId, lead.ownerName, lead.name, lead.company, lead.phone, lead.email,
      lead.status, lead.value, lead.source, lead.notes, JSON.stringify(lead.activity),
      lead.region, lead.currency,
    ]
  );
  return rows[0];
}
// Insert many leads in one go (used by the CSV/XLSX bulk upload). Runs inside
// a single transaction so a mid-batch failure doesn't leave a half-imported file.
async function createLeadsBulk(leads) {
  const client = await pool.connect();
  const inserted = [];
  try {
    await client.query('BEGIN');
    for (const lead of leads) {
      const { rows } = await client.query(
        `INSERT INTO leads (owner_id, owner_name, name, company, phone, email, status, value, source, notes, activity, region, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          lead.ownerId, lead.ownerName, lead.name, lead.company, lead.phone, lead.email,
          lead.status, lead.value, lead.source, lead.notes, JSON.stringify(lead.activity),
          lead.region, lead.currency,
        ]
      );
      inserted.push(rows[0]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return inserted;
}
async function updateLead(id, fields) {
  const current = await getLead(id);
  if (!current) return null;
  const merged = { ...current, ...fields };
  const { rows } = await pool.query(
    `UPDATE leads SET name=$1, company=$2, phone=$3, email=$4, status=$5, value=$6,
       source=$7, notes=$8, activity=$9, region=$10, currency=$11,
       owner_id=$12, owner_name=$13, updated_at=now()
     WHERE id=$14 RETURNING *`,
    [
      merged.name, merged.company, merged.phone, merged.email, merged.status, merged.value,
      merged.source, merged.notes, JSON.stringify(merged.activity), merged.region, merged.currency,
      merged.owner_id, merged.owner_name, id,
    ]
  );
  return rows[0];
}
async function deleteLead(id) {
  const { rowCount } = await pool.query('DELETE FROM leads WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  init,
  getUserByEmployeeId, listUsers, createUser, deleteUser,
  listLeads, getLead, createLead, createLeadsBulk, updateLead, deleteLead,
};
