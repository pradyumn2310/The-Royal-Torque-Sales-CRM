# The Royal Torque — Sales CRM

A sales CRM: login dashboard, admin user management, and lead tracking for your whole team. Data is stored in a free, permanent Postgres database (Neon) — this is what lets the app run on free cloud hosting (Render) **with no credit card anywhere** and without losing data when the service restarts.

> **Changed from the local-file version:** data used to be saved in a local `data/db.json` file. That approach can't survive on free cloud hosting without a paid persistent disk, so it's now a small free cloud database instead — still free, still permanent, just not a file on your laptop. Locally, this also now needs that same database (see step 2) rather than working offline out of the box.

## 1. One-time: install Node.js

Get it from [nodejs.org](https://nodejs.org) (version 18+, the "LTS" installer). Skip if already installed.

## 2. One-time: create your free database (Neon)

1. Go to [neon.tech](https://neon.tech) → sign up (no credit card).
2. Create a new project (any name, e.g. "royal-torque-crm").
3. On the project dashboard, find **Connection string** (sometimes under "Connection Details") and copy it. It looks like:
   `postgresql://user:password@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require`
4. In this project folder, copy `.env.example` to a new file named `.env`, and paste your connection string in as `DATABASE_URL`.

The app creates its own tables and your admin login (`2310` / `Princy!@_2123`) automatically the first time it starts — nothing else to set up in Neon.

## 3. Run it locally

```
npm install
npm start
```

Open `http://localhost:4000`. The database tables are also what the cloud version uses, so leads/users you add locally and leads/users added on the cloud version are the same data if they point at the same `DATABASE_URL`.

## 4. Deploy to Render (free, no credit card, permanent URL)

This is the part that means no more `npm install` for you or your team — just a web link.

1. Put this project in a GitHub repository (free, no card): create a new repo at [github.com/new](https://github.com/new), then from this folder:
   ```
   git init
   git add .
   git commit -m "Royal Torque CRM"
   git branch -M main
   git remote add origin <your-new-repo-URL>
   git push -u origin main
   ```
2. Go to [render.com](https://render.com) → sign up (no credit card) → **New +** → **Web Service** → connect the GitHub repo you just pushed.
3. Render auto-detects Node. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Under **Environment**, add an environment variable:
   - `DATABASE_URL` = your Neon connection string (same one from step 2)
5. Click **Create Web Service**. First deploy takes a couple of minutes.
6. You'll get a permanent link like `https://royal-torque-crm.onrender.com` — that's what you and your team use from now on. No terminal, no Node, no local setup.

**One free-tier quirk to know:** Render's free web service "sleeps" after about 15 minutes with no visitors, and the first request after that takes ~30–50 seconds to wake it back up (then it's fast again). Your data is unaffected by this — it's a wake-up delay, not a data reset, because the data now lives in Neon, separate from Render's own storage. If that wake delay ever becomes annoying, Render's paid tier removes it; everything else about this setup stays the same either way.

To push future code changes: commit and `git push` — Render redeploys automatically.

## 5. Logging in

- **Employee ID:** `2310`
- **Password:** `Princy!@_2123`

## 6. Adding your team

Log in as admin → **Team / Admin** in the sidebar → enter an Employee ID (you choose the numbering, e.g. 2311, 2312…), name, and password → **Create User**. Each user only sees and edits their own leads; admins see everyone's via **All Leads**, plus a team breakdown on the **Dashboard**.

## 7. What's included

- Login dashboard with Royal Torque branding
- Admin: create/remove users, assign employee-ID-based logins and roles
- Each sales user: add, edit, delete their own leads
- Admin: view all leads across the team, plus per-person performance
- Lead pipeline stages: New → Contacted → Qualified → Proposal → Won / Lost
- Per-lead activity log (auto-logs status changes, plus manual notes)
- Search and filter leads by status
- Dashboard stats: total leads, open pipeline value, won value, breakdown by stage and by team member
