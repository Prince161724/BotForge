/**
 * Training Routes — PDF upload, status check, and delete
 * 
 * These endpoints are used by the EMBEDDABLE WIDGET (not the main BotForge site).
 * Auth is via widgetToken (the token passed in the script tag URL), NOT JWT.
 * 
 * Namespace strategy: {widgetToken}_{botId}
 * Each widget deployment (script tag with unique token) gets its own isolated namespace.
 * Two different sites embedding the same bot will NEVER see each other's data.
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { Pinecone } = require('@pinecone-database/pinecone');

const router = express.Router();

// ── In-memory training status store (keyed by namespace) ──
// This is lightweight since widget users don't have DB accounts
const trainingStore = new Map();
// Structure: { namespace: { status, fileName, trainedAt } }

// ── Multer setup ────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = `widget_${req.body.widgetToken || 'unknown'}_${req.params.botId}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed.'), false);
    }
    cb(null, true);
  }
});

// ── Helper: Build namespace ─────────────────────────────
function buildNamespace(widgetToken, botId) {
  return `${widgetToken}_${botId}`;
}

// ── POST /api/training/widget-upload/:botId ──────────────
// Widget-based upload — uses widgetToken from body, no JWT needed
router.post('/widget-upload/:botId', (req, res) => {
  upload.single('pdf')(req, res, async (multerErr) => {
    if (multerErr) {
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
      }
      return res.status(400).json({ error: multerErr.message || 'Upload error.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded.' });
    }

    const { botId } = req.params;
    const widgetToken = req.body.widgetToken;

    if (!widgetToken) {
      fs.unlinkSync(req.file.path);
      return res.status(401).json({ error: 'Widget token is required.' });
    }

    if (!botId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Bot ID is required.' });
    }

    try {
      const namespace = buildNamespace(widgetToken, botId);

      // If already has training data, delete old Pinecone namespace
      if (trainingStore.has(namespace)) {
        try {
          const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
          const index = pinecone.Index(process.env.PINECONE_INDEX);
          await index.namespace(namespace).deleteAll();
        } catch (e) {
          console.log('Old namespace cleanup skipped:', e.message);
        }
      }

      // Set status to processing
      trainingStore.set(namespace, {
        status: 'processing',
        fileName: req.file.originalname,
        trainedAt: new Date()
      });

      // Respond immediately — processing happens in background
      res.json({
        message: 'PDF uploaded! Training in progress...',
        status: 'processing',
        fileName: req.file.originalname
      });

      // Spawn worker thread for embedding
      const workerPath = path.join(__dirname, '..', 'workers', 'embedWorker.js');
      const worker = new Worker(workerPath, {
        workerData: {
          filePath: req.file.path,
          namespace,
          fileName: req.file.originalname,
          openaiKey: process.env.OPENAI_API_KEY,
          pineconeKey: process.env.PINECONE_API_KEY,
          pineconeIndex: process.env.PINECONE_INDEX
        }
      });

      worker.on('message', (result) => {
        if (result.success) {
          trainingStore.set(namespace, {
            status: 'ready',
            fileName: req.file.originalname,
            trainedAt: new Date()
          });
          console.log(`✅ Widget training complete for ${namespace}: ${result.chunksProcessed} chunks`);
        } else {
          trainingStore.set(namespace, {
            status: 'failed',
            fileName: req.file.originalname,
            trainedAt: new Date()
          });
          console.error(`❌ Widget training failed for ${namespace}:`, result.error);
        }

        // Clean up temp file
        try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      });

      worker.on('error', (err) => {
        console.error(`❌ Worker error for ${namespace}:`, err.message);
        trainingStore.set(namespace, {
          status: 'failed',
          fileName: req.file.originalname,
          trainedAt: new Date()
        });
        try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      });

    } catch (error) {
      console.error('Widget training upload error:', error);
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      }
      res.status(500).json({ error: 'Server error during upload.' });
    }
  });
});

// ── GET /api/training/widget-status/:botId ───────────────
// Check training status for a widget deployment
router.get('/widget-status/:botId', (req, res) => {
  const widgetToken = req.query.token;
  if (!widgetToken) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  const namespace = buildNamespace(widgetToken, req.params.botId);
  const training = trainingStore.get(namespace);

  if (!training) {
    return res.json({ trained: false });
  }

  res.json({
    trained: true,
    status: training.status,
    fileName: training.fileName,
    trainedAt: training.trainedAt,
    namespace: namespace
  });
});

// ── DELETE /api/training/widget/:botId ───────────────────
// Remove training data for a widget deployment
router.delete('/widget/:botId', async (req, res) => {
  const widgetToken = req.query.token;
  if (!widgetToken) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  const namespace = buildNamespace(widgetToken, req.params.botId);

  if (!trainingStore.has(namespace)) {
    return res.status(404).json({ error: 'No training data found.' });
  }

  // Delete from Pinecone
  try {
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pinecone.Index(process.env.PINECONE_INDEX);
    await index.namespace(namespace).deleteAll();
    console.log(`🗑️ Deleted Pinecone namespace: ${namespace}`);
  } catch (e) {
    console.error('Pinecone delete error:', e.message);
  }

  trainingStore.delete(namespace);
  res.json({ message: 'Training data removed successfully.' });
});

// Export trainingStore so chat.js can check it
module.exports = router;
module.exports.trainingStore = trainingStore;
module.exports.buildNamespace = buildNamespace;
