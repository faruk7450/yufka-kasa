BEGIN;

-- Temiz kurulum (isteğe göre kaldırabilirsin)
DROP TABLE IF EXISTS ledger_entries CASCADE;
DROP TABLE IF EXISTS expense_entries CASCADE;
DROP TABLE IF EXISTS production_entries CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL,
  role         text NOT NULL CHECK (role IN ('ADMIN','STAFF_CASH','STAFF')),
  pin_hash     text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL,
  phone          text,
  price_per_pack numeric(12,2) NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id           bigserial PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES customers(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('SALE','PAYMENT','RETURN')),
  packs        numeric(12,2) NOT NULL DEFAULT 0,
  unit_price   numeric(12,2) NOT NULL DEFAULT 0,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expense_entries (
  id           bigserial PRIMARY KEY,
  amount       numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE production_entries (
  id           bigserial PRIMARY KEY,
  packs        numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Müşteri bakiye görünümü
CREATE OR REPLACE VIEW customer_balances AS
SELECT
  c.id AS customer_id,
  COALESCE(SUM(le.amount), 0) AS balance
FROM customers c
LEFT JOIN ledger_entries le ON le.customer_id = c.id
WHERE c.is_active = true
GROUP BY c.id;

COMMIT;
