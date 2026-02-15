import express from "express";
import cors from "cors";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";

const app = express();
app.use(express.json());

// ---- CORS ----
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    return cb(null, allowedOrigins.includes(origin));
  }
}));

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL yok (Render env).");
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

// ---- DB init ----
async function initDb() {
  const sql = fs.readFileSync(new URL("./db.sql", import.meta.url), "utf8");
  await pool.query(sql);

  // kullanıcılar yoksa ekle
  const adminPin = String(process.env.ADMIN_PIN || "1234");
  const staffCashPin = String(process.env.STAFF_CASH_PIN || "1111");
  const staffPin = String(process.env.STAFF_PIN || "2222");

  const adminHash = await bcrypt.hash(adminPin, 10);
  const cashHash = await bcrypt.hash(staffCashPin, 10);
  const staffHash = await bcrypt.hash(staffPin, 10);

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Admin', 'ADMIN', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='ADMIN');`,
    [adminHash]
  );

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Personel-1', 'STAFF_CASH', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='STAFF_CASH');`,
    [cashHash]
  );

  await pool.query(
    `INSERT INTO users(name, role, pin_hash)
     SELECT 'Personel-2', 'STAFF', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='STAFF');`,
    [staffHash]
  );
}

initDb().catch(e => console.error("DB init hata:", e));

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

// ---- COMPANIES ----
app.get("/companies", authRequired, async (_req, res) => {
  const r = await pool.query(`
    SELECT c.id, c.name, c.phone, c.price_per_pack,
           COALESCE(b.balance,0) AS balance
    FROM companies c
    LEFT JOIN company_balances b ON b.company_id=c.id
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
     ON CONFLICT (name) DO UPDATE SET
       phone=EXCLUDED.phone,
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

  if (!r.rowCount) return res.status(404).json({ error: "Firma yok" });
  res.json(r.rows[0]);
});

app.delete("/companies/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE companies SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`,
    [id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Firma yok" });
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

  const r = await pool.query(
    `INSERT INTO branches(company_id, name)
     VALUES($1,$2)
     ON CONFLICT (company_id, name) DO UPDATE SET is_active=true
     RETURNING *`,
    [companyId, name]
  );

  res.json(r.rows[0]);
});

app.delete("/branches/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE branches SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`,
    [id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Şube yok" });
  res.json({ ok: true });
});

// ---- LEDGER V2 ----
app.post("/ledger", authRequired, async (req, res) => {
  const { companyId, branchId, type, packs, amount, note, entryDate } = req.body;

  if (!["SALE_CREDIT","CASH_SALE","PAYMENT","RETURN","DEBIT"].includes(type)) {
    return res.status(400).json({ error: "Geçersiz type" });
  }

  const c = await pool.query(
    `SELECT price_per_pack FROM companies WHERE id=$1 AND is_active=true`,
    [Number(companyId)]
  );
  if (!c.rowCount) return res.status(404).json({ error: "Firma yok" });

  const unitPrice = Number(c.rows[0].price_per_pack);
  const p = Number(packs || 0);
  const rawAmount = Number(amount || 0);

  let packsFinal = 0;
  let unitPriceFinal = 0;
  let amountSigned = 0;

  // Borç mantığı:
  // SALE_CREDIT: + (packs*price)
  // PAYMENT    : - (amount)
  // RETURN     : - (packs*price)
  // DEBIT      : +/-(amount)  (manuel)
  // CASH_SALE  : 0 (borca yansıtma) ama satış raporuna girecek
  if (type === "PAYMENT") {
    amountSigned = -Math.abs(rawAmount);
  } else if (type === "DEBIT") {
    // + borç artırır, - borç düşürür (kullanıcı girdiği gibi)
    amountSigned = Number(rawAmount || 0);
  } else if (type === "CASH_SALE") {
    packsFinal = p;
    unitPriceFinal = unitPrice;
    amountSigned = 0;
  } else if (type === "SALE_CREDIT") {
    packsFinal = p;
    unitPriceFinal = unitPrice;
    amountSigned = Math.abs(p * unitPrice);
  } else if (type === "RETURN") {
    packsFinal = p;
    unitPriceFinal = unitPrice;
    amountSigned = -Math.abs(p * unitPrice);
  }

  if ((type === "PAYMENT" || type === "DEBIT") && !rawAmount) {
    return res.status(400).json({ error: "Tutar gerekli" });
  }
  if ((type === "SALE_CREDIT" || type === "CASH_SALE" || type === "RETURN") && p <= 0) {
    return res.status(400).json({ error: "Paket gerekli" });
  }

  // sadece ADMIN geçmiş tarih
  const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO ledger_entries_v2(company_id, branch_id, entry_type, packs, unit_price, amount, note, created_by, entry_date)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, CURRENT_DATE))
     RETURNING *`,
    [
      Number(companyId),
      branchId ? Number(branchId) : null,
      type,
      packsFinal,
      unitPriceFinal,
      amountSigned,
      note || null,
      Number(req.user.uid),
      finalDate
    ]
  );

  res.json(r.rows[0]);
});

// ---- REPORTS ----
async function summaryBetween(from, to) {
  // satış raporu: SALE_CREDIT + CASH_SALE (ikisinin de satış tutarı = packs*unit_price)
  const sales = await pool.query(
    `SELECT COALESCE(SUM(packs*unit_price),0) AS total
     FROM ledger_entries_v2
     WHERE entry_type IN ('SALE_CREDIT','CASH_SALE') AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const payments = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM ledger_entries_v2
     WHERE entry_type='PAYMENT' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const returns = await pool.query(
    `SELECT COALESCE(SUM(packs*unit_price),0) AS total
     FROM ledger_entries_v2
     WHERE entry_type='RETURN' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const creditSales = await pool.query(
    `SELECT COALESCE(SUM(packs*unit_price),0) AS total
     FROM ledger_entries_v2
     WHERE entry_type='SALE_CREDIT' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const cashSales = await pool.query(
    `SELECT COALESCE(SUM(packs*unit_price),0) AS total
     FROM ledger_entries_v2
     WHERE entry_type='CASH_SALE' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const expenses = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM expense_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  const production = await pool.query(
    `SELECT COALESCE(SUM(packs),0) AS packs
     FROM production_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  return {
    from,
    to,
    sales: Number(sales.rows[0].total),
    creditSales: Number(creditSales.rows[0].total),
    cashSales: Number(cashSales.rows[0].total),
    payments: Math.abs(Number(payments.rows[0].total)),
    returns: Number(returns.rows[0].total),
    expenses: Number(expenses.rows[0].total),
    productionPacks: Number(production.rows[0].packs)
  };
}

app.get("/reports/range", authRequired, async (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "from/to YYYY-MM-DD olmalı" });
  }
  res.json(await summaryBetween(from, to));
});

app.get("/reports/month", authRequired, async (req, res) => {
  const ym = String(req.query.ym || "");
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: "ym YYYY-MM olmalı" });

  const from = `${ym}-01`;
  const toQ = await pool.query(
    `SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date AS d`,
    [from]
  );
  const to = toQ.rows[0].d.toISOString().slice(0,10);

  res.json(await summaryBetween(from, to));
});

app.get("/reports/today", authRequired, async (_req, res) => {
  const today = new Date().toISOString().slice(0,10);
  res.json(await summaryBetween(today, today));
});

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// root -> UI
app.get("/", (_req, res) => res.sendFile(new URL("./public/index.html", import.meta.url)));

app.listen(process.env.PORT || 3000, () => console.log("API up"));
