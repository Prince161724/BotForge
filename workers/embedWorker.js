/**
 * embedWorker.js — Worker thread for PDF → embeddings → Pinecone pipeline
 * 
 * Runs off the main thread so PDF processing doesn't block the server.
 * Namespace: userId_botId ensures complete isolation between users.
 */
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');

// ── Config ──────────────────────────────────────────────
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 50; // Pinecone upsert batch size

// ── Text Chunking ───────────────────────────────────────
function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start += chunkSize - overlap;
  }

  return chunks;
}

// ── Main Pipeline ───────────────────────────────────────
async function embedAndStore(filePath, namespace) {
  // 1. Load PDF
  // pdf-parse exports a default function — do NOT destructure it
  const pdfParse = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  const rawText = pdfData.text;

  if (!rawText || rawText.trim().length === 0) {
    throw new Error('PDF contains no extractable text.');
  }

  // 2. Chunk the text
  const chunks = chunkText(rawText);
  if (chunks.length === 0) {
    throw new Error('No text chunks generated from PDF.');
  }

  // 3. Generate embeddings via OpenAI
  const openai = new OpenAI({ apiKey: workerData.openaiKey });

  const embeddings = [];
  // Process in batches to avoid rate limits
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch
    });
    for (let j = 0; j < response.data.length; j++) {
      embeddings.push({
        id: `${namespace}_chunk_${i + j}`,
        values: response.data[j].embedding,
        metadata: {
          text: batch[j],
          chunkIndex: i + j,
          source: workerData.fileName || 'uploaded.pdf'
        }
      });
    }
  }

  // 4. Upsert to Pinecone
  const pinecone = new Pinecone({ apiKey: workerData.pineconeKey });
  const index = pinecone.Index(workerData.pineconeIndex);
  const ns = index.namespace(namespace);

  // Delete any old data in this namespace first
  try {
    await ns.deleteAll();
  } catch (e) {
    // Namespace may not exist yet — that's fine
  }

  // Upsert in batches — Pinecone SDK v7 requires { records: [...] } format
  for (let i = 0; i < embeddings.length; i += BATCH_SIZE) {
    const batch = embeddings.slice(i, i + BATCH_SIZE);
    await ns.upsert({ records: batch });
  }

  return {
    success: true,
    chunksProcessed: chunks.length,
    vectorsStored: embeddings.length
  };
}

// ── Execute ─────────────────────────────────────────────
(async function () {
  try {
    const { filePath, namespace } = workerData;
    const result = await embedAndStore(filePath, namespace);
    parentPort.postMessage(result);
  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err.message
    });
  }
})();
