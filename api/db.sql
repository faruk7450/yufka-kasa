BEGIN;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL,
  role         text NOT NULL CHECK (role IN ('ADMIN','STAFF_CASH','STAFF')),
  pin_hash     text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- COMPANIES (FİRMA)
CREATE TABLE IF NOT EXISTS companies (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL UNIQUE,
  phone        text,
  price_per_pack numeric(12,2) NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- BRANCHES (ŞUBE)
CREATE TABLE IF NOT EXISTS branches (
  id           bigserial PRIMARY KEY,
  company_id   bigint NOT NULL REFERENCES companies(id),
  name         text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, name)
);

-- LEDGER (SATIŞ / TAHSİLAT / İADE / VERESİYE)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id           bigserial PRIMARY KEY,
  company_id   bigint NOT NULL REFERENCES companies(id),
  branch_id    bigint REFERENCES branches(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('SALE','CASH_SALE','PAYMENT','RETURN','DEBT_ADD')),
  packs        numeric(12,2) NOT NULL DEFAULT 0,
  unit_price   numeric(12,2) NOT NULL DEFAULT 0,
  amount       numeric(12,2) NOT NULL DEFAULT 0,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- EXPENSE
CREATE TABLE IF NOT EXISTS expense_entries (
  id           bigserial PRIMARY KEY,
  amount       numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- PRODUCTION
CREATE TABLE IF NOT EXISTS production_entries (
  id           bigserial PRIMARY KEY,
  packs        numeric(12,2) NOT NULL,
  note         text,
  created_by   bigint NOT NULL REFERENCES users(id),
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Güvenli kolon eklemeleri (eski DB'de yoksa ekler)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS price_per_pack numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS branch_id bigint;

COMMIT;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_entry_type_check'
  ) THEN
    ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_entry_type_check;
  END IF;

  ALTER TABLE ledger_entries
    ADD CONSTRAINT ledger_entries_entry_type_check
    CHECK (entry_type IN ('SALE','CASH_SALE','PAYMENT','RETURN','DEBT_ADD'));
END $$;
