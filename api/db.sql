CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','STAFF','STAFF_CASH')),
  pin TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  price_per_pack NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('SALE','PAYMENT','RETURN')),
  packs INT NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL,
  note TEXT,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS production_entries (
  id SERIAL PRIMARY KEY,
  packs INT NOT NULL,
  note TEXT,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS expense_entries (
  id SERIAL PRIMARY KEY,
  amount NUMERIC(12,2) NOT NULL,
  note TEXT NOT NULL,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE OR REPLACE VIEW customer_balances AS
SELECT
  c.id AS customer_id,
  c.name,
  COALESCE(SUM(le.amount), 0) AS balance
FROM customers c
LEFT JOIN ledger_entries le ON le.customer_id = c.id
GROUP BY c.id, c.name;
