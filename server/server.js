import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { extractText } from './src/extractText.js';
import { detectPII } from './src/detectors.js';
import { redactText } from './src/redactor.js';
import { generateDocx } from './src/generateDocx.js';

// Handle uncaught exceptions and unhandled promise rejections to avoid process crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
const PORT = process.env.PORT || 3001;

// Configure CORS dynamically based on incoming Origin header to avoid wildcard issues with exposed headers
app.use(cors({
  origin: (origin, callback) => {
    // Allow all origins (origin will be undefined for same-origin or tool requests like curl)
    callback(null, true);
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition', 'X-Redaction-Stats'],
  optionsSuccessStatus: 200 // Some legacy/mobile browsers choke on 204
}));

app.use(express.json());

// Configure Multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB file size limit
  }
});

// Primary Redaction Route
app.post('/redact', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Please upload a PDF or DOCX file.' });
    }

    const { buffer, mimetype, originalname } = req.file;

    // Step 1: Extract Text from Document
    const rawText = await extractText(buffer, mimetype, originalname);
    if (!rawText || rawText.trim().length === 0) {
      return res.status(422).json({ error: 'Failed to extract text from the document. The file might be empty or unreadable.' });
    }

    // Step 2: Detect PII
    const detected = detectPII(rawText);

    // Step 3: Redact and Replace with Fake consistent replacements
    const { redactedText, stats } = redactText(rawText, detected);

    // Step 4: Generate output .docx file
    const docxBuffer = await generateDocx(redactedText);

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

  } catch (error) {
    next(error);
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'PII Redactor Server is running' });
});

// Root route to show server status and prevent "Cannot GET /" confusion
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Aegis Redact API Server is running. The frontend is available at https://pii-redaction-tool-six.vercel.app',
    endpoints: {
      health: '/health',
      redact: '/redact (POST)'
    }
  });
});


// Global error handling middleware to ensure CORS headers are ALWAYS set, even on failure
app.use((err, req, res, next) => {
  console.error('API Error:', err);

  // In Express, we must set these explicitly inside error handler to ensure they are present
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

