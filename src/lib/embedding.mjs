// Sentence embeddings computed locally with transformers.js (ONNX runtime, no external API).
// Shared by the Next.js API (query embeddings) and the background worker (document embeddings).
import path from 'node:path';
import { pipeline, env } from '@huggingface/transformers';

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

env.cacheDir = path.resolve(process.cwd(), '.cache', 'models');

let extractorPromise = globalThis.__shopsenseExtractor;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'fp32' }).then((ex) => {
      // all-MiniLM-L6-v2 was trained on 256-token inputs; longer text is truncated, and capping here
      // avoids padding every batch out to 512 tokens
      ex.tokenizer.model_max_length = 256;
      return ex;
    });
    globalThis.__shopsenseExtractor = extractorPromise; // survive Next.js dev hot reloads
  }
  return extractorPromise;
}

/** Embed a batch of texts -> array of 384-d unit vectors (mean pooling + L2 normalisation). */
export async function embed(texts) {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  return output.tolist();
}

export async function embedOne(text) {
  return (await embed([text]))[0];
}

/** pgvector text literal: '[0.1,0.2,...]' */
export function toPgVector(vec) {
  return `[${vec.map((x) => x.toFixed(6)).join(',')}]`;
}
