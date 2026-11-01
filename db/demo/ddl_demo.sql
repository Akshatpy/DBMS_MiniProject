-- =====================================================================
-- DDL walkthrough on a scratch table: CREATE / ALTER / DROP.
-- Self-contained and re-runnable; touches nothing in the real schema.
--   docker exec -i shopsense-db psql -U shopsense_owner -d shopsense < db/demo/ddl_demo.sql
-- =====================================================================
\set ON_ERROR_STOP off
\echo '--- 1. CREATE TABLE with PK, FK, CHECK, UNIQUE, DEFAULT'
DROP TABLE IF EXISTS demo_coupons CASCADE;
CREATE TABLE demo_coupons (
  coupon_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT NOT NULL,
  category_id INT REFERENCES categories (category_id) ON DELETE SET NULL,
  percent_off NUMERIC(4, 1) NOT NULL DEFAULT 10,
  CONSTRAINT uq_demo_coupons_code UNIQUE (code),
  CONSTRAINT chk_demo_percent CHECK (percent_off > 0 AND percent_off <= 90)
);
INSERT INTO demo_coupons (code, percent_off) VALUES ('WELCOME10', 10), ('FESTIVE25', 25);

\echo '--- 2. ALTER TABLE: add a column, backfill, then make it NOT NULL'
ALTER TABLE demo_coupons ADD COLUMN expires_on DATE;
UPDATE demo_coupons SET expires_on = current_date + 30;
ALTER TABLE demo_coupons ALTER COLUMN expires_on SET NOT NULL;

\echo '--- 3. ALTER TABLE: add a CHECK across columns, widen a type, rename a column'
ALTER TABLE demo_coupons ADD CONSTRAINT chk_demo_future CHECK (expires_on >= DATE '2024-01-01');
ALTER TABLE demo_coupons ALTER COLUMN percent_off TYPE NUMERIC(5, 2);
ALTER TABLE demo_coupons RENAME COLUMN percent_off TO discount_percent;

\echo '--- 4. constraints reject bad data (each statement below is EXPECTED to fail)'
INSERT INTO demo_coupons (code, discount_percent, expires_on) VALUES ('WELCOME10', 5, current_date);   -- duplicate code
INSERT INTO demo_coupons (code, discount_percent, expires_on) VALUES ('TOOBIG', 95, current_date);      -- CHECK violated
INSERT INTO demo_coupons (code, category_id, expires_on) VALUES ('BADFK', -1, current_date);            -- FK violated

\echo '--- 5. CREATE INDEX / VIEW, then DROP them'
CREATE INDEX idx_demo_coupons_expiry ON demo_coupons (expires_on) WHERE discount_percent >= 20;
CREATE VIEW v_demo_active_coupons AS SELECT code, discount_percent FROM demo_coupons WHERE expires_on >= current_date;
SELECT * FROM v_demo_active_coupons;
DROP VIEW v_demo_active_coupons;
DROP INDEX idx_demo_coupons_expiry;

\echo '--- 6. ALTER TABLE ... DROP CONSTRAINT / DROP COLUMN, then DROP TABLE'
ALTER TABLE demo_coupons DROP CONSTRAINT chk_demo_future;
ALTER TABLE demo_coupons DROP COLUMN category_id;
\d demo_coupons
DROP TABLE demo_coupons;
\echo '--- done: scratch table dropped'
