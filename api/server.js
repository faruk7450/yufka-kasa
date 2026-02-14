import express from "express";
import cors from "cors";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());

// ---- CORS (güvenlik) ----
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Render + browser olmayan istekler (curl) için origin null gelebilir
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true); // boşsa serbest (istersen sıkılaştırırız)
    return cb(null, allowedOrigins.includes(origin));
  }
}));

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL yok. Render env içine koymalısın.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase pooler bazen cert zinciri uyarısı verebiliyor:
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

// ---- DB init (sıfır kurulum) ----
async function initDb() {
  // db.sql çalıştır
  const fs = await import("fs");
  const sql = fs.readFileSync(new URL("./db.sql", import.meta.url), "utf8");
  await pool.query(sql);

  // admin pin (render env ile kontrol)
  const adminPin = String(process.env.ADMIN_PIN || "1234");
  const staffCashPin = String(process.env.STAFF_CASH_PIN || "1111");
  const staffPin = String(process.env.STAFF_PIN || "2222");

  const adminHash = await bcrypt.hash(adminPin, 10);
  const cashHash = await bcrypt.hash(staffCashPin, 10);
  const staffHash = await bcrypt.hash(staffPin, 10);

  // Kullanıcılar yoksa ekle (pin_hash ile)
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

// init (Render boot)
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

// ---- CUSTOMERS ----
app.get("/customers", authRequired, async (_req, res) => {
  const r = await pool.query(`
    SELECT c.id, c.name, c.phone, c.price_per_pack,
           COALESCE(b.balance,0) AS balance
    FROM customers c
    LEFT JOIN customer_balances b ON b.customer_id=c.id
    WHERE c.is_active=true
    ORDER BY c.name
  `);
  res.json(r.rows);
});

app.post("/customers", authRequired, requireRole("ADMIN"), async (req, res) => {
  const { name, phone, pricePerPack } = req.body;
  const r = await pool.query(
    "INSERT INTO customers(name, phone, price_per_pack) VALUES($1,$2,$3) RETURNING *",
    [String(name || "").trim(), phone || null, Number(pricePerPack || 0)]
  );
  res.json(r.rows[0]);
});

app.put("/customers/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const { name, phone, pricePerPack } = req.body;

  const r = await pool.query(
    `UPDATE customers
     SET name=$1, phone=$2, price_per_pack=$3
     WHERE id=$4 AND is_active=true
     RETURNING *`,
    [String(name || "").trim(), phone || null, Number(pricePerPack || 0), id]
  );

  if (r.rowCount === 0) return res.status(404).json({ error: "Müşteri bulunamadı" });
  res.json(r.rows[0]);
});

// “Kaldır” = soft delete
app.delete("/customers/:id", authRequired, requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query(
    `UPDATE customers SET is_active=false WHERE id=$1 AND is_active=true RETURNING id`,
    [id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "Müşteri bulunamadı" });
  res.json({ ok: true });
});

// ---- LEDGER (satış/tahsilat/iade) ----
app.post("/ledger", authRequired, async (req, res) => {
  const { customerId, type, packs, note, entryDate, amount } = req.body;

  if (!["SALE", "PAYMENT", "RETURN"].includes(type)) {
    return res.status(400).json({ error: "Geçersiz type" });
  }

  // müşteri var mı
  const c = await pool.query("SELECT price_per_pack FROM customers WHERE id=$1 AND is_active=true", [Number(customerId)]);
  if (c.rowCount === 0) return res.status(404).json({ error: "Firma yok" });

  const unitPrice = Number(c.rows[0].price_per_pack);
  const p = Number(packs || 0);
  const rawAmount = Number(amount || 0);

  let amountSigned = 0;
  let packsFinal = 0;
  let unitPriceFinal = 0;

  if (type === "PAYMENT") {
    amountSigned = -Math.abs(rawAmount);
  } else if (type === "SALE") {
    packsFinal = p;
    unitPriceFinal = unitPrice;
    amountSigned = Math.abs(p * unitPrice);
  } else if (type === "RETURN") {
    packsFinal = p;
    unitPriceFinal = unitPrice;
    amountSigned = -Math.abs(p * unitPrice);
  }

  // sadece ADMIN geçmiş tarih girebilir
  const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO ledger_entries(customer_id, entry_type, packs, unit_price, amount, note, created_by, entry_date)
     VALUES($1,$2,$3,$4,$5,$6,$7, COALESCE($8, CURRENT_DATE))
     RETURNING *`,
    [Number(customerId), type, packsFinal, unitPriceFinal, amountSigned, note || null, Number(req.user.uid), finalDate]
  );

  res.json(r.rows[0]);
});

// ---- EXPENSES ----
app.post("/expenses", authRequired, async (req, res) => {
  const { amount, note, entryDate } = req.body;
  const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO expense_entries(amount, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [Math.abs(Number(amount || 0)), String(note || ""), Number(req.user.uid), finalDate]
  );
  res.json(r.rows[0]);
});

// ---- PRODUCTION ----
app.post("/production", authRequired, async (req, res) => {
  const { packs, note, entryDate } = req.body;
  const finalDate = (req.user.role === "ADMIN" && entryDate) ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO production_entries(packs, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [Number(packs || 0), note || null, Number(req.user.uid), finalDate]
  );
  res.json(r.rows[0]);
});

// ---- REPORTS ----
async function summaryBetween(from, to) {
  const sales = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries
     WHERE entry_type='SALE' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const payments = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries
     WHERE entry_type='PAYMENT' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const returns = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries
     WHERE entry_type='RETURN' AND entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const expenses = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM expense_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const production = await pool.query(
    `SELECT COALESCE(SUM(packs),0) AS packs FROM production_entries
     WHERE entry_date BETWEEN $1 AND $2`,
    [from, to]
  );

  return {
    from,
    to,
    sales: Number(sales.rows[0].total),
    payments: Number(payments.rows[0].total),
    returns: Number(returns.rows[0].total),
    expenses: Number(expenses.rows[0].total),
    productionPacks: Number(production.rows[0].packs)
  };
}

app.get("/reports/today", authRequired, async (_req, res) => {
  const r = await summaryBetween("CURRENT_DATE", "CURRENT_DATE");
  // CURRENT_DATE string olduğu için yukarıdaki helper'a uymuyor.
  // Bu yüzden today için direkt query:
  const sales = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries WHERE entry_type='SALE' AND entry_date=CURRENT_DATE`
  );
  const payments = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries WHERE entry_type='PAYMENT' AND entry_date=CURRENT_DATE`
  );
  const returns = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger_entries WHERE entry_type='RETURN' AND entry_date=CURRENT_DATE`
  );
  const expenses = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total FROM expense_entries WHERE entry_date=CURRENT_DATE`
  );
  const production = await pool.query(
    `SELECT COALESCE(SUM(packs),0) AS packs FROM production_entries WHERE entry_date=CURRENT_DATE`
  );

  res.json({
    sales: Number(sales.rows[0].total),
    payments: Number(payments.rows[0].total),
    returns: Number(returns.rows[0].total),
    expenses: Number(expenses.rows[0].total),
    productionPacks: Number(production.rows[0].packs)
  });
});

// /reports/range?from=YYYY-MM-DD&to=YYYY-MM-DD
app.get("/reports/range", authRequired, async (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: "from/to formatı YYYY-MM-DD olmalı" });
  }

  const data = await summaryBetween(from, to);
  res.json(data);
});

// /reports/month?ym=YYYY-MM  (örn: 2026-02)
app.get("/reports/month", authRequired, async (req, res) => {
  const ym = String(req.query.ym || "");
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: "ym formatı YYYY-MM olmalı" });

  const from = `${ym}-01`;
  // ay sonu: to'yu SQL'e bırakalım (safe)
  const toQ = await pool.query(`SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date AS d`, [from]);
  const to = toQ.rows[0].d.toISOString().slice(0,10);

  const data = await summaryBetween(from, to);
  res.json(data);
});

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

// root -> UI
app.get("/", (_req, res) => res.sendFile(new URL("./public/index.html", import.meta.url)));

app.listen(process.env.PORT || 3000, () => console.log("API up"));
