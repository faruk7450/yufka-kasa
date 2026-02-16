import express from "express";
import cors from "cors";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());

// ---- CORS ----
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  }
}));

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL yok. Render env içine koymalısın.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE_VERIFY === "1"
    ? { rejectUnauthorized: false }
    : undefined
});

// ---- JWT ----
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const TOKEN_TTL = "30d";

function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Auth gerekli" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token geçersiz" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Auth gerekli" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Yetki yok" });
    next();
  };
}

// ---- DB init (veri silmez) ----
async function initDb() {
  const fs = await import("fs");
  const sql = fs.readFileSync(new URL("./db.sql", import.meta.url), "utf8");
  await pool.query(sql);

  const adminPin = String(process.env.ADMIN_PIN || "1234");
  const staffCashPin = String(process.env.STAFF_CASH_PIN || "1111");
  const staffPin = String(process.env.STAFF_PIN || "2222");

  const adminHash = await bcrypt.hash(adminPin, 10);
  const cashHash = await bcrypt.hash(staffCashPin, 10);
  const staffHash = await bcrypt.hash(staffPin, 10);

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Yönetici', 'ADMIN', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='ADMIN');`,
    [adminHash]
  );

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Kasa', 'STAFF_CASH', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='STAFF_CASH');`,
    [cashHash]
  );

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Personel', 'STAFF', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='STAFF');`,
    [staffHash]
  );
}

initDb().catch((e) => console.error("DB init hata:", e));

// ---- Static UI ----
app.use(express.static(new URL("./public/", import.meta.url).pathname));

// ---- AUTH ----
app.post("/auth/login", async (req, res) => {
  const pin = String(req.body?.pin || "");
  if (!pin) return res.status(400).json({ error: "PIN gerekli" });

  const r = await pool.query(
    `SELECT id, name, role, pin_hash, is_active
     FROM users
     WHERE is_active=true
     ORDER BY id ASC`
  );

  const user = r.rows.find(u => bcrypt.compareSync(pin, u.pin_hash));
  if (!user) return res.status(401).json({ error: "Hatalı PIN" });

  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// ---- BALANCE helpers ----
async function companyBalance(companyId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS bal
     FROM ledger_entries
     WHERE company_id=$1`,
    [companyId]
  );
  return Number(r.rows[0].bal);
}

async function branchBalance(branchId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS bal
     FROM ledger_entries
     WHERE branch_id=$1`,
    [branchId]
  );
  return Number(r.rows[0].bal);
}

// ---- COMPANIES ----
app.get("/companies", authRequired, async (_req, res) => {
  // balance dahil (UI dropdown bunu kullanıyor)
  const r = await pool.query(`
    SELECT
      c.id, c.name, c.phone, c.price_per_pack,
      COALESCE((
        SELECT SUM(le.amount)
        FROM ledger_entries le
        WHERE le.company_id = c.id
      ), 0) AS balance
    FROM companies c
    WHERE c.is_active=true
    ORDER BY c.name
  `);
  res.json(r.rows);
});

app.post("/companies", authRequired, requireRole("ADMIN"), async (req, res) => {
  const { name, phone, pricePerPack } = req.body;
  const nm = String(name || "").trim();
  if (!nm) return res.status(400).json({ error: "Firma adı gerekli" });

  const r = await pool.query(
    `INSERT INTO companies(name, phone, price_per_pack)
     VALUES($1,$2,$3)
     ON CONFLICT (name) DO UPDATE
       SET phone=EXCLUDED.phone,
           price_per_pack=EXCLUDED.price_per_pack,
           is_active=true
     RETURNING *`,
    [nm, phone || null, Number(pricePerPack || 0)]
  );
  res.json(r.rows[0]);
});

app.put("/companies/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, phone, pricePerPack } = req.body;
  const nm = String(name || "").trim();
  if (!nm) return res.status(400).json({ error: "Firma adı gerekli" });

  const r = await pool.query(
    `UPDATE companies
     SET name=$1, phone=$2, price_per_pack=$3
     WHERE id=$4 AND is_active=true
     RETURNING *`,
    [nm, phone || null, Number(pricePerPack || 0), id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Firma bulunamadı" });
  res.json(r.rows[0]);
});

app.delete("/companies/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE companies SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`,
    [id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Firma bulunamadı" });
  res.json({ ok: true });
});

// ---- BRANCHES ----
app.get("/companies/:companyId/branches", authRequired, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const r = await pool.query(
    `SELECT id, company_id, name
     FROM branches
     WHERE company_id=$1 AND is_active=true
     ORDER BY name`,
    [companyId]
  );
  res.json(r.rows);
});

app.post("/companies/:companyId/branches", authRequired, requireRole("ADMIN"), async (req, res) => {
  const companyId = Number(req.params.companyId);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Şube adı gerekli" });

  const c = await pool.query(`SELECT id FROM companies WHERE id=$1 AND is_active=true`, [companyId]);
  if (c.rowCount === 0) return res.status(404).json({ error: "Firma yok" });

  const r = await pool.query(
    `INSERT INTO branches(company_id, name)
     VALUES($1,$2)
     ON CONFLICT (company_id, name) DO UPDATE SET is_active=true
     RETURNING *`,
    [companyId, name]
  );
  res.json(r.rows[0]);
});

app.put("/branches/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Şube adı gerekli" });

  const r = await pool.query(
    `UPDATE branches SET name=$1
     WHERE id=$2 AND is_active=true
     RETURNING *`,
    [name, id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Şube bulunamadı" });
  res.json(r.rows[0]);
});

app.delete("/branches/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE branches SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`,
    [id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Şube bulunamadı" });
  res.json({ ok: true });
});

// ---- LEDGER ----
// server type’lar:
// SALE, CASH_SALE, PAYMENT, RETURN, DEBT_ADD
app.post("/ledger", authRequired, async (req, res) => {
  try {
    const { companyId, branchId, type, packs, amount, note, entryDate } = req.body;

    if (!["SALE","CASH_SALE","PAYMENT","RETURN","DEBT_ADD"].includes(type)) {
      return res.status(400).json({ error: "Geçersiz type" });
    }

    const cid = Number(companyId || 0);
    const bid = branchId ? Number(branchId) : null;
    if (!cid) return res.status(400).json({ error: "Firma seç" });

    const c = await pool.query(
      `SELECT price_per_pack FROM companies WHERE id=$1 AND is_active=true`,
      [cid]
    );
    if (c.rowCount === 0) return res.status(404).json({ error: "Firma yok" });
    const unitPrice = Number(c.rows[0].price_per_pack || 0);

    if (bid) {
      const b = await pool.query(
        `SELECT id FROM branches WHERE id=$1 AND company_id=$2 AND is_active=true`,
        [bid, cid]
      );
      if (b.rowCount === 0) return res.status(400).json({ error: "Şube bu firmaya ait değil" });
    }

    const p = Number(packs || 0);
    const a = Number(amount || 0);

    let packsFinal = 0;
    let unitPriceFinal = 0;
    let amountSigned = 0;

    if (type === "PAYMENT") {
      if (a <= 0) return res.status(400).json({ error: "Tahsilat tutarı gir" });
      amountSigned = -Math.abs(a);
    } else if (type === "DEBT_ADD") {
      if (a <= 0) return res.status(400).json({ error: "Alacak/Veresiye tutarı gir" });
      amountSigned = Math.abs(a);
    } else {
      if (p <= 0) return res.status(400).json({ error: "Paket gir" });
      packsFinal = p;
      unitPriceFinal = unitPrice;
      const base = Math.abs(p * unitPrice);

      if (type === "SALE" || type === "CASH_SALE") amountSigned = base;
      if (type === "RETURN") amountSigned = -base;
    }

    const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

    const r = await pool.query(
      `INSERT INTO ledger_entries(company_id, branch_id, entry_type, packs, unit_price, amount, note, created_by, entry_date)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, CURRENT_DATE))
       RETURNING *`,
      [cid, bid, type, packsFinal, unitPriceFinal, amountSigned, note || null, Number(req.user.uid), finalDate]
    );

    res.json(r.rows[0]);
  } catch (e) {
    console.error("LEDGER ERROR:", e);
    res.status(500).json({ error: "Sunucu hatası (ledger)" });
  }
});

// ---- EXPENSES ----
app.post("/expenses", authRequired, async (req, res) => {
  const { amount, note, entryDate } = req.body;
  const a = Math.abs(Number(amount || 0));
  if (a <= 0) return res.status(400).json({ error: "Gider tutarı gir" });

  const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO expense_entries(amount, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [a, String(note || ""), Number(req.user.uid), finalDate]
  );
  res.json(r.rows[0]);
});

// ---- PRODUCTION ----
app.post("/production", authRequired, async (req, res) => {
  const { packs, note, entryDate } = req.body;
  const p = Number(packs || 0);
  if (p <= 0) return res.status(400).json({ error: "Üretim paket gir" });

  const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO production_entries(packs, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [p, note || null, Number(req.user.uid), finalDate]
  );
  res.json(r.rows[0]);
});

// ---- REPORTS ----
// app.js şu alanları bekliyor: sales, creditSales, cashSales, payments, returns, expenses, productionPacks
async function summaryBetween(from, to) {
  const qNum = async (sql, params) => Number((await pool.query(sql, params)).rows[0].v);

  const creditSales = await qNum(
    `SELECT COALESCE(SUM(amount),0) v FROM ledger_entries
     WHERE entry_type='SALE' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const cashSales = await qNum(
    `SELECT COALESCE(SUM(amount),0) v FROM ledger_entries
     WHERE entry_type='CASH_SALE' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const sales = Number(creditSales) + Number(cashSales);

  const paymentsRaw = await qNum(
    `SELECT COALESCE(SUM(amount),0) v FROM ledger_entries
     WHERE entry_type='PAYMENT' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const payments = Math.abs(paymentsRaw);

  const returnsRaw = await qNum(
    `SELECT COALESCE(SUM(amount),0) v FROM ledger_entries
     WHERE entry_type='RETURN' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const returns = Math.abs(returnsRaw);

  const expenses = await qNum(
    `SELECT COALESCE(SUM(amount),0) v FROM expense_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const productionPacks = await qNum(
    `SELECT COALESCE(SUM(packs),0) v FROM production_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  return { from, to, sales, creditSales, cashSales, payments, returns, expenses, productionPacks };
}

app.get("/reports/today", authRequired, async (_req, res) => {
  const d = new Date().toISOString().slice(0,10);
  res.json(await summaryBetween(d, d));
});

app.get("/reports/range", authRequired, async (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "from/to formatı YYYY-MM-DD olmalı" });
  }

  res.json(await summaryBetween(from, to));
});

app.get("/reports/month", authRequired, async (req, res) => {
  const ym = String(req.query.ym || "");
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: "ym formatı YYYY-MM olmalı" });

  const from = `${ym}-01`;
  const toQ = await pool.query(
    `SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date AS d`,
    [from]
  );
  const to = toQ.rows[0].d.toISOString().slice(0,10);

  res.json(await summaryBetween(from, to));
});

// balances
app.get("/balances/company/:companyId", authRequired, async (req, res) => {
  const companyId = Number(req.params.companyId);
  const bal = await companyBalance(companyId);
  res.json({ balance: bal });
});
app.get("/balances/branch/:branchId", authRequired, async (req, res) => {
  const branchId = Number(req.params.branchId);
  const bal = await branchBalance(branchId);
  res.json({ balance: bal });
});

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// root -> UI
app.get("/", (_req, res) => res.sendFile(new URL("./public/index.html", import.meta.url)));

app.listen(process.env.PORT || 3000, () => console.log("API up"));
