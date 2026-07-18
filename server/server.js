import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { extractText } from './src/extractText.js';
import { detectPII } from './src/detectors.js';
import { redactText } from './src/redactor.js';
import { generateDocx } from './src/generateDocx.js';

// Prevent Node process crashes from unhandled asynchronous failures
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
const PORT = process.env.PORT || 3001;

// Helper to log Node.js memory metrics stage-by-stage
function logMemoryUsage(stage) {
  const mem = process.memoryUsage();
  console.log(
    `[Memory - ${stage.padEnd(20)}] ` +
    `Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2).padStart(6)} MB / ` +
    `RSS: ${(mem.rss / 1024 / 1024).toFixed(2).padStart(6)} MB / ` +
    `External: ${(mem.external / 1024 / 1024).toFixed(2).padStart(6)} MB`
  );
}

// 1. Configure CORS dynamically based on request origin to ensure compatibility with credentials
app.use(cors({
  origin: (origin, callback) => {
    // Allow all origins (origin will be undefined for same-origin or tool requests like curl)
    callback(null, true);
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition', 'X-Redaction-Stats'],
  optionsSuccessStatus: 200 // Older browsers choke on 204
}));

// 2. Request timeout protection (25 seconds)
// Prevents Render reverse proxy from dropping connection at 30 seconds, which results in browser CORS errors.
app.use((req, res, next) => {
  res.setTimeout(25000, () => {
    if (!res.headersSent) {
      console.error(`Request timeout triggered at 25s for ${req.method} ${req.url}`);
      res.status(503).json({
        error: 'Service Unavailable',
        message: 'Request timed out. The document is too large to process within the server timeout limits.'
      });
    }
  });
  next();
});

app.use(express.json());

// Configure Multer for memory storage with a strict 15MB file size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB file size limit
  }
});

// Primary Redaction Route
app.post('/redact', upload.single('file'), async (req, res, next) => {
  logMemoryUsage('Upload Start');

  try {
    // Input Validation
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please upload a PDF or DOCX file.' });
    }

    const { buffer, mimetype, originalname } = req.file;

    // Validate file extensions
    const fileExt = originalname.toLowerCase().substring(originalname.lastIndexOf('.'));
    if (fileExt !== '.pdf' && fileExt !== '.docx') {
      return res.status(400).json({ error: 'Invalid file format. Only PDF and DOCX files are supported.' });
    }

    console.log(`Processing file: ${originalname} (${(buffer.length / 1024 / 1024).toFixed(2)} MB), Type: ${mimetype}`);

    // Step 1: Extract Text from Document
    const rawText = await extractText(buffer, mimetype, originalname);
    
    // Proactively release buffer reference to let GC free memory immediately
    req.file.buffer = null;
    logMemoryUsage('After Text Extract');

    if (!rawText || rawText.trim().length === 0) {
      return res.status(422).json({ error: 'Failed to extract text from the document. The file might be empty, password protected, or unreadable.' });
    }

    // Step 2: Detect PII
    const detected = detectPII(rawText);
    logMemoryUsage('After PII Detection');

    // Step 3: Redact and Replace with deterministic fakes
    const { redactedText, stats } = redactText(rawText, detected);
    logMemoryUsage('After Redaction');

    // Step 4: Generate output .docx file
    const docxBuffer = await generateDocx(redactedText);
    logMemoryUsage('After Docx Gen');

    // Prepare filename for download
    const nameWithoutExt = originalname.substring(0, originalname.lastIndexOf('.')) || originalname;
    const safeOutputName = `redacted_${nameWithoutExt}.docx`;

    // Attach redaction stats in response headers (base64 encoded JSON)
    const statsJson = JSON.stringify(stats);
    const statsBase64 = Buffer.from(statsJson).toString('base64');
    res.setHeader('X-Redaction-Stats', statsBase64);

    // Send docx as binary file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeOutputName)}"`);
    
    res.send(docxBuffer);
    console.log(`Successfully completed redaction of: ${originalname}`);
    logMemoryUsage('Response Sent');

  } catch (error) {
    next(error);
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'PII Redactor Server is running' });
});

// Root route redirect to frontend or return health status to prevent "Cannot GET /"
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Aegis Redact API Server is running. The frontend client is available at https://pii-redaction-tool-six.vercel.app',
    endpoints: {
      health: '/health',
      redact: '/redact (POST)'
    }
  });
});

// GET route for /redact to handle direct browser visits gracefully
app.get('/redact', (req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'The /redact endpoint only accepts POST requests with a multipart/form-data payload containing a "file" field.'
  });
});

// Production-ready global error handling middleware
app.use((err, req, res, next) => {
  console.error('API Error Encountered:', err);

  // In Express, we must set these explicitly inside error handler to ensure they are present in cross-origin responses
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size limit exceeded. Maximum file size allowed is 15MB.' });
    }
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }

  res.status(err.status || 500).json({
    error: err.message || 'An unexpected error occurred during processing.'
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
