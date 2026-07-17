import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { extractText } from './src/extractText.js';
import { detectPII } from './src/detectors.js';
import { redactText } from './src/redactor.js';
import { generateDocx } from './src/generateDocx.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Configure CORS and expose headers so the frontend can read filename and redaction metrics
app.use(cors({
  origin: '*',
  exposedHeaders: ['Content-Disposition', 'X-Redaction-Stats']
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
app.post('/redact', upload.single('file'), async (req, res) => {
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
    console.error('Redaction error:', error);
    res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'PII Redactor Server is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
