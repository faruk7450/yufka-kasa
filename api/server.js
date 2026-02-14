import express from "express";
import cors from "cors";
import pg from "pg";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const { Pool } = pg;

// Render'da env adı DATABASE_URL olmalı (senin ekranında öyleydi)
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL yok. Render Environment'a koymalısın.");
  process.exit(1);
}

// ✅ 1) SSL zinciri/self-signed hatası için
// Supabase pooler kullanırken Render ortamında bazen bu gerekiyor.
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDb() {
  // ✅ 2) BOM temizliği (db.sql başındaki gizli karakter CREATE'i bozuyor)
  let sql = fs.readFileSync(new URL("./db.sql", import.meta.url), "utf8");
  sql = sql.replace(/^\uFEFF/, ""); // BOM temizle

  // Bazı editörler başa görünmeyen karakterler koyuyor, bunu da temizleyelim:
  sql = sql.trim();

  await pool.query(sql);

  const adminPin = process.env.ADMIN_PIN || "1234";

  await pool.query(
    `INSERT INTO users(name, role, pin)
     SELECT 'Admin', 'ADMIN', $1
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='ADMIN');`,
    [adminPin]
  );

  await pool.query(
    `INSERT INTO users(name, role, pin)
     SELECT 'Personel-1', 'STAFF_CASH', '1111'
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE pin='1111');`
  );

  await pool.query(
    `INSERT INTO users(name, role, pin)
     SELECT 'Personel-2', 'STAFF', '2222'
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE pin='2222');`
  );

  console.log("DB init OK");
}

initDb().catch((e) => console.error("DB init hata:", e));

app.post("/auth/login", async (req, res) => {
  const { pin } = req.body;
  const r = await pool.query(
    "SELECT id, name, role FROM users WHERE pin=$1 AND is_active=true",
    [String(pin || "")]
  );
  if (r.rowCount === 0) return res.status(401).json({ error: "Hatalı PIN" });
  res.json(r.rows[0]);
});

app.get("/customers", async (_req, res) => {
  const r = await pool.query(`
    SELECT c.id, c.name, c.phone, c.price_per_pack, COALESCE(b.balance,0) AS balance
    FROM customers c
    LEFT JOIN customer_balances b ON b.customer_id=c.id
    ORDER BY c.name
  `);
  res.json(r.rows);
});

app.post("/customers", async (req, res) => {
  const { userRole, name, phone, pricePerPack } = req.body;
  if (userRole !== "ADMIN") return res.status(403).json({ error: "Yetki yok" });

  const r = await pool.query(
    "INSERT INTO customers(name, phone, price_per_pack) VALUES($1,$2,$3) RETURNING *",
    [String(name), phone || null, Number(pricePerPack || 0)]
  );
  res.json(r.rows[0]);
});

app.post("/customers/:id/price", async (req, res) => {
  const { userRole, pricePerPack } = req.body;
  if (userRole !== "ADMIN") return res.status(403).json({ error: "Yetki yok" });

  const r = await pool.query(
    "UPDATE customers SET price_per_pack=$1 WHERE id=$2 RETURNING *",
    [Number(pricePerPack), Number(req.params.id)]
  );
  res.json(r.rows[0]);
});

app.post("/ledger", async (req, res) => {
  const { userId, userRole, customerId, type, packs, note, entryDate } = req.body;

  if (!["SALE", "PAYMENT", "RETURN"].includes(type)) {
    return res.status(400).json({ error: "Geçersiz type" });
  }

  const c = await pool.query("SELECT price_per_pack FROM customers WHERE id=$1", [Number(customerId)]);
  if (c.rowCount === 0) return res.status(404).json({ error: "Firma yok" });

  const unitPrice = Number(c.rows[0].price_per_pack);
  const p = Number(packs || 0);
  const rawAmount = Number(req.body.amount || 0);

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

  const finalDate = userRole === "ADMIN" && entryDate ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO ledger_entries(customer_id, entry_type, packs, unit_price, amount, note, created_by, entry_date)
     VALUES($1,$2,$3,$4,$5,$6,$7, COALESCE($8, CURRENT_DATE))
     RETURNING *`,
    [Number(customerId), type, packsFinal, unitPriceFinal, amountSigned, note || null, Number(userId), finalDate]
  );

  res.json(r.rows[0]);
});

app.post("/expenses", async (req, res) => {
  const { userId, userRole, amount, note, entryDate } = req.body;
  const finalDate = userRole === "ADMIN" && entryDate ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO expense_entries(amount, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [Math.abs(Number(amount)), String(note || ""), Number(userId), finalDate]
  );
  res.json(r.rows[0]);
});

app.post("/production", async (req, res) => {
  const { userId, userRole, packs, note, entryDate } = req.body;
  const finalDate = userRole === "ADMIN" && entryDate ? entryDate : null;

  const r = await pool.query(
    `INSERT INTO production_entries(packs, note, created_by, entry_date)
     VALUES($1,$2,$3, COALESCE($4, CURRENT_DATE))
     RETURNING *`,
    [Number(packs), note || null, Number(userId), finalDate]
  );
  res.json(r.rows[0]);
});

app.get("/reports/today", async (_req, res) => {
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
    productionPacks: Number(production.rows[0].packs),
  });
});

app.get("/", (_req, res) => res.send("OK"));
app.listen(process.env.PORT || 3000, () => console.log("API up"));
