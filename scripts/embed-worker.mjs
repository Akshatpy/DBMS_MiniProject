// Embedding worker: drains the embedding_jobs queue that triggers fill.
//  * Claims jobs with  FOR UPDATE SKIP LOCKED  -> several workers can run without double work
//  * Sleeps on LISTEN embedding_jobs           -> wakes up as soon as a trigger NOTIFYs
//  * Skips re-embedding when the text hash is unchanged
// Usage: npm run worker        (long-running)
//        npm run embed:all     (process the whole backlog once, then refresh analytics and exit)
import crypto from 'node:crypto';
import pg from 'pg';
import { embed, toPgVector, EMBEDDING_MODEL } from '../src/lib/embedding.mjs';

const BATCH = 64;
const once = process.argv.includes('--once');
const pool = new pg.Pool({ connectionString: process.env.OWNER_DATABASE_URL, max: 2 });
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

async function processBatch() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: jobs } = await client.query(
      `WITH picked AS (
         SELECT job_id FROM embedding_jobs
          WHERE processed_at IS NULL AND attempts < 5
          ORDER BY enqueued_at, job_id
          LIMIT $1
          FOR UPDATE SKIP LOCKED)
       UPDATE embedding_jobs j SET started_at = now(), attempts = attempts + 1
         FROM picked WHERE j.job_id = picked.job_id
       RETURNING j.job_id, j.entity_type, j.entity_id`, [BATCH]);
    if (jobs.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    const products = jobs.filter((j) => j.entity_type === 'product').map((j) => j.entity_id);
    const reviews = jobs.filter((j) => j.entity_type === 'review').map((j) => j.entity_id);
    const { rows: docs } = await client.query(
      `SELECT 'product' AS type, id, product_embedding_text(id) AS text,
              (SELECT source_hash FROM product_embeddings WHERE product_id = id) AS old_hash
         FROM unnest($1::bigint[]) AS id
       UNION ALL
       SELECT 'review', id, review_embedding_text(id),
              (SELECT source_hash FROM review_embeddings WHERE review_id = id)
         FROM unnest($2::bigint[]) AS id`, [products, reviews]);

    // entities deleted since enqueueing have NULL text; unchanged text keeps its old vector
    const todo = docs.filter((d) => d.text && md5(d.text) !== d.old_hash);
    if (todo.length) {
      const vectors = await embed(todo.map((d) => d.text));
      for (const [i, d] of todo.entries()) {
        const table = d.type === 'product' ? 'product_embeddings' : 'review_embeddings';
        const key = d.type === 'product' ? 'product_id' : 'review_id';
        await client.query(
          `INSERT INTO ${table} (${key}, embedding, model, source_hash, embedded_at)
           VALUES ($1, $2::vector, $3, $4, now())
           ON CONFLICT (${key}) DO UPDATE
             SET embedding = EXCLUDED.embedding, model = EXCLUDED.model,
                 source_hash = EXCLUDED.source_hash, embedded_at = now()`,
          [d.id, toPgVector(vectors[i]), EMBEDDING_MODEL, md5(d.text)]);
      }
    }
    await client.query(`UPDATE embedding_jobs SET processed_at = now(), last_error = NULL
                         WHERE job_id = ANY($1::bigint[])`, [jobs.map((j) => j.job_id)]);
    await client.query('COMMIT');
    return jobs.length;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('batch failed:', err.message);
    await pool.query(`UPDATE embedding_jobs SET last_error = $1 WHERE processed_at IS NULL AND started_at > now() - interval '1 minute'`,
      [err.message.slice(0, 500)]).catch(() => {});
    return 0;
  } finally {
    client.release();
  }
}

async function drain() {
  let total = 0, n;
  const t0 = Date.now();
  while ((n = await processBatch()) > 0) {
    total += n;
    if (once) process.stdout.write(`\rembedded ${total} jobs (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  if (total && once) process.stdout.write('\n');
  return total;
}

console.log(`Embedding worker using ${EMBEDDING_MODEL}`);
if (once) {
  await drain();
  console.log('Refreshing materialized views and taste profiles ...');
  await pool.query('CALL refresh_analytics()');
  await pool.end();
} else {
  const listener = new pg.Client({ connectionString: process.env.OWNER_DATABASE_URL });
  await listener.connect();
  await listener.query('LISTEN embedding_jobs');
  let running = false, pending = false;
  const kick = async () => {
    if (running) { pending = true; return; }
    running = true;
    do {
      pending = false;
      const n = await drain();
      if (n) console.log(`${new Date().toLocaleTimeString()}  embedded ${n} job(s)`);
    } while (pending);
    running = false;
  };
  listener.on('notification', kick);
  setInterval(kick, 30_000); // safety net for missed notifications / retries
  await kick();
  console.log('Listening for embedding_jobs notifications ...');
}
