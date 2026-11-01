-- =====================================================================
-- 01  Extensions, enum types and domains
-- =====================================================================
-- pgvector : vector data type + HNSW/IVFFlat indexes + distance operators
-- pgcrypto : bcrypt password hashing inside the database (crypt/gen_salt)
-- pg_trgm  : trigram similarity for typo-tolerant title autocomplete
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Enumerated types (closed sets of values) ----------
CREATE TYPE user_role      AS ENUM ('customer', 'seller', 'admin');
CREATE TYPE order_status   AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'cancelled');
CREATE TYPE payment_method AS ENUM ('upi', 'card', 'netbanking', 'cod');
CREATE TYPE payment_status AS ENUM ('pending', 'success', 'failed', 'refunded');
CREATE TYPE search_mode    AS ENUM ('lexical', 'semantic', 'hybrid');

-- ---------- Domains: reusable, database-level input validation ----------
CREATE DOMAIN email_address AS TEXT
  CHECK (VALUE ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$');

CREATE DOMAIN money_inr AS NUMERIC(12, 2)
  CHECK (VALUE >= 0);

CREATE DOMAIN indian_pincode AS CHAR(6)
  CHECK (VALUE ~ '^[1-9][0-9]{5}$');

CREATE DOMAIN indian_phone AS TEXT
  CHECK (VALUE ~ '^[6-9][0-9]{9}$');

-- GSTIN: 2-digit state code, 10-char PAN, entity number, 'Z', checksum
CREATE DOMAIN gstin_code AS TEXT
  CHECK (VALUE ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
