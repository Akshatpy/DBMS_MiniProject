// Generates docs/data-dictionary.md and docs/schema-reference.md from the LIVE database catalog,
// so the documentation can never drift from the real schema.   npm run docs
import fs from 'node:fs';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.OWNER_DATABASE_URL });
await db.connect();
const q = async (sql, p) => (await db.query(sql, p)).rows;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

const tables = await q(`SELECT c.relname AS name, c.oid, c.reltuples::bigint AS approx_rows, obj_description(c.oid) AS comment
                          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`);
const out = ['# Data Dictionary', '', `_Generated from the live PostgreSQL catalog on ${new Date().toISOString().slice(0, 10)} by \`npm run docs\`._`, ''];

for (const t of tables) {
  const cols = await q(`
    SELECT a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
           pg_get_expr(d.adbin, d.adrelid) AS dflt, a.attgenerated <> '' AS generated,
           (SELECT string_agg(
                     CASE con.contype WHEN 'p' THEN 'PK' WHEN 'u' THEN 'UNIQUE' WHEN 'f' THEN 'FK → ' || cf.relname END, ', ')
              FROM pg_constraint con
              LEFT JOIN pg_class cf ON cf.oid = con.confrelid
             WHERE con.conrelid = a.attrelid AND a.attnum = ANY (con.conkey) AND con.contype IN ('p', 'u', 'f')) AS keys
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [t.oid]);
  const checks = await q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1 AND contype = 'c' ORDER BY conname`, [t.oid]);
  const fks = await q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1 AND contype = 'f' ORDER BY conname`, [t.oid]);
  const idx = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`, [t.name]);
  const trg = await q(`SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = $1 AND NOT tgisinternal ORDER BY tgname`, [t.oid]);
  const pol = await q(`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname`, [t.name]);

  out.push(`## ${t.name}`, '');
  out.push('| Column | Type | Null | Default / generated | Keys |', '|---|---|---|---|---|');
  for (const c of cols) {
    out.push(`| ${c.col} | ${esc(c.type)} | ${c.nullable ? 'yes' : 'no'} | ${c.generated ? '_generated_' : esc(c.dflt ?? '')} | ${esc(c.keys ?? '')} |`);
  }
  if (checks.length) { out.push('', '**CHECK constraints**', ''); checks.forEach((c) => out.push(`- \`${c.conname}\`: \`${esc(c.def)}\``)); }
  if (fks.length) { out.push('', '**Foreign keys**', ''); fks.forEach((f) => out.push(`- \`${f.conname}\`: \`${esc(f.def)}\``)); }
  if (idx.length) { out.push('', '**Indexes**', ''); idx.forEach((i) => out.push(`- \`${esc(i.indexdef)}\``)); }
  if (trg.length) { out.push('', '**Triggers**', ''); trg.forEach((g) => out.push(`- \`${esc(g.def)}\``)); }
  if (pol.length) { out.push('', '**Row-Level Security policies**', ''); pol.forEach((p) => out.push(`- \`${p.policyname}\` (${p.cmd})${p.qual ? ` USING \`${esc(p.qual)}\`` : ''}${p.with_check ? ` WITH CHECK \`${esc(p.with_check)}\`` : ''}`)); }
  out.push('');
}

const domains = await q(`SELECT t.typname AS name, format_type(t.typbasetype, t.typtypmod) AS base, pg_get_constraintdef(c.oid) AS def
                           FROM pg_type t JOIN pg_constraint c ON c.contypid = t.oid WHERE t.typtype = 'd' ORDER BY t.typname`);
const enums = await q(`SELECT t.typname AS name, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS labels
                         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname ORDER BY t.typname`);
out.push('## Domains (reusable validation)', '', '| Domain | Base type | Constraint |', '|---|---|---|');
domains.forEach((d) => out.push(`| ${d.name} | ${d.base} | \`${esc(d.def)}\` |`));
out.push('', '## Enumerated types', '', '| Type | Values |', '|---|---|');
enums.forEach((e) => out.push(`| ${e.name} | ${e.labels} |`));
fs.writeFileSync('docs/data-dictionary.md', out.join('\n') + '\n');

// ------------------------------------------------------------ schema reference (views, functions, triggers)
const ref = ['# Schema Reference: views, functions, procedures, triggers', '', `_Generated ${new Date().toISOString().slice(0, 10)}._`, ''];
const views = await q(`SELECT c.relname AS name, c.relkind AS kind, obj_description(c.oid) AS comment FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') ORDER BY c.relkind DESC, c.relname`);
ref.push('## Views and materialized views', '', '| Name | Kind |', '|---|---|');
views.forEach((v) => ref.push(`| ${v.name} | ${v.kind === 'm' ? 'MATERIALIZED VIEW' : 'VIEW'} |`));
const fns = await q(`SELECT p.proname AS name, p.prokind AS kind, pg_get_function_identity_arguments(p.oid) AS args,
                            pg_get_function_result(p.oid) AS result, p.prosecdef AS definer, l.lanname AS lang
                       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
                      WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') AND p.prorettype <> 'trigger'::regtype
                        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')   -- skip extension-owned
                      ORDER BY p.prokind DESC, p.proname`);
ref.push('', '## Functions and procedures', '', '| Name | Kind | Arguments | Returns | Security | Language |', '|---|---|---|---|---|---|');
fns.forEach((f) => ref.push(`| ${f.name} | ${f.kind === 'p' ? 'PROCEDURE' : 'FUNCTION'} | ${esc(f.args)} | ${esc(f.result ?? '')} | ${f.definer ? 'DEFINER' : 'invoker'} | ${f.lang} |`));
const trgs = await q(`SELECT c.relname AS tbl, g.tgname AS name, pg_get_triggerdef(g.oid) AS def FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
                       WHERE NOT g.tgisinternal ORDER BY c.relname, g.tgname`);
ref.push('', '## Triggers', '', '| Table | Trigger | Definition |', '|---|---|---|');
trgs.forEach((t) => ref.push(`| ${t.tbl} | ${t.name} | \`${esc(t.def.replace(/^CREATE TRIGGER \S+ /, ''))}\` |`));
fs.writeFileSync('docs/schema-reference.md', ref.join('\n') + '\n');

console.log(`Wrote docs/data-dictionary.md (${tables.length} tables) and docs/schema-reference.md (${views.length} views, ${fns.length} routines, ${trgs.length} triggers)`);
await db.end();
