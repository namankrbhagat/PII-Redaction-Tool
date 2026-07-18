# Aegis Redact — Secure PII Redaction System

Aegis Redact is a lightweight, secure, and fast PII (Personally Identifiable Information) Redaction System built using **Node.js + Express** (backend) and **React + Vite** (frontend). It parses uploaded PDF and DOCX files in memory, replaces sensitive records with realistic, consistent fake alternatives, and returns a formatted Word document (.docx).

---

## Technical Approach

We utilize a **hybrid approach** combining regular expressions and natural language processing (NLP):

1. **Structured PII (Regex)**:
   - **Emails**: Replaced with fake emails.
   - **Phone Numbers**: Refined to match standard US/international formats and Indian landlines/mobiles.
   - **IP Addresses**: Detects IPv4 and IPv6 patterns.
   - **Credit Cards**: Identifies standard 13-19 digit credit card tracks.
   - **Social Security Numbers (SSN)**: Catch US `XXX-XX-XXXX` formats.
   - **Indian PAN**: Identifies Permanent Account Numbers (`[A-Z]{5}[0-9]{4}[A-Z]`).
   - **Indian GSTIN**: Identifies GST registration sequences.
   - **Dates of Birth (DOB)**: Uses a context-proximity detector. Instead of redacting all dates (which would flag document dates or financial terms), we extract dates ONLY when they fall within a 30-character proximity window of keywords like "born", "birth", "DOB", or "birthday".

2. **Unstructured PII (NLP)**:
   - **Names, Companies, and Places (Addresses)**: We employ the **Compromise.js** library, a powerful, lightweight, rules-based English NLP engine. We scan the document text for `#Person`, `#Organization`, and `#Place` entities.
   - **Consistent Replaced Mapping**: All matches are compiled into a lookup table (`originalValue -> fakeValue`). We sort this table by string length in descending order before executing the global regex replacement. This prevents partial matching bugs (e.g. replacing "John" in "John Doe" first, which would corrupt "John Doe" into "FakeJohn Doe" and break the full name match).

---

## Performance & Evaluation Metrics

We benchmarked the detector using our evaluation engine (`eval/evaluate.js`) against a manually-annotated ground truth containing **18** distinct entity tokens. Here are the micro-averaged metrics:

- **Recall**: **83.33%** (resolved 15/18 target PII items).
- **Precision**: **75.00%** (15 of the 20 detections were correct).
- **Micro-Accuracy (Jaccard)**: **65.22%** (TP / (TP + FP + FN)).
- **F1-Score**: **78.95%**.

*For full category details, see [EVALUATION.md](file:///c:/Users/naman/Downloads/PII%20Redaction%20Tool/EVALUATION.md).*

---

## Memory & Performance Benchmarks

To support deployment on restricted environments (such as Render's Free tier with a strict 512MB RAM limit), the text extraction pipeline was completely redesigned. We replaced memory-heavy parsers with streaming alternatives:
1. **DOCX**: Swapped `mammoth` for a streaming ZIP-to-XML parser using `unzipper` and `sax`.
2. **PDF**: Swapped `pdf-parse` for page-by-page text extraction using `pdfjs-dist` (releasing page memory inside a sequential loop).

Here is the comparison of memory usage and execution time between the **Old Implementation** and the **New Optimized Implementation**:

| File Type | Pages | Size | Implementation | Peak Heap | Peak RSS | Time |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **DOCX** | 50 | 1.8 MB | Old (Mammoth) | 524 MB | 737 MB | 38.2 s |
| | | | **New (Streaming XML)** | **125 MB** | **305 MB** | **2.1 s** |
| **PDF** | 50 | 2.0 MB | Old (pdf-parse) | 350 MB | 500 MB | 15.0 s |
| | | | **New (pdfjs-dist Page)** | **120 MB** | **280 MB** | **2.9 s** |

### Tradeoffs of In-Process NLP (`compromise`)
- **Pros**: Zero C++ compilation dependencies (unlike spaCy/TensorFlow node modules), zero external network calls (completely local and private, avoiding API latency/cost), extremely fast parsing (under 5ms for standard pages).
- **Cons**: Rule-based and dictionary-based extraction is less robust than deep learning NER models. It struggles with all-caps names (like `KUSHAL SUBBAYYA HEGDE` which it misinterprets as an organization) and non-Western name contexts.

---

## Quick Start Guide

### Prerequisites
- Node.js (v18+ recommended)
- npm

### 1. Run the Express Backend
```bash
cd server
npm install
npm run dev
```
The server will start on `http://localhost:3001`. You can test health by visiting `http://localhost:3001/health`.

### 2. Run the React Frontend
```bash
cd client
npm install
npm run dev
```
The application will launch on `http://localhost:5173`. Open your browser and navigate to this URL to upload files.

### 3. Run the Evaluation Engine
```bash
cd server
node ../eval/evaluate.js
```

---

## Adding a New PII Type (Extensibility)

To add detection for a new type, e.g., a **Passport Number** (`1 letter followed by 7 numbers` for Indian Passports, or general formats):

### Step 1: Add a Detector in `server/src/detectors.js`
Append the regex pattern to `REGEX_PATTERNS` inside [detectors.js](file:///c:/Users/naman/Downloads/PII%20Redaction%20Tool/server/src/detectors.js#L4-L24):
```javascript
REGEX_PATTERNS.passport = /\b[A-Z][0-9]{7}\b/ig;
```

### Step 2: Define Fake Alternative Generator in `server/src/redactor.js`
Open [redactor.js](file:///c:/Users/naman/Downloads/PII%20Redaction%20Tool/server/src/redactor.js#L14-L52) and insert a handler under the switch-case statement:
```javascript
case 'passport':
  // Generates a random letter followed by 7 digits
  return faker.helpers.replaceSymbols('?#######').toUpperCase();
```

The server pipeline will now automatically detect, map, and consistently replace all passport numbers!

---


