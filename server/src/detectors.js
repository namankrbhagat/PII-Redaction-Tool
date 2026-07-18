import nlp from 'compromise';

// Regex patterns for structured PII (compiled once globally and reused by resetting lastIndex)
const REGEX_PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // IPv4 and IPv6
  ip: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b|\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
  
  // Credit card (13 to 19 digits, with optional spaces or hyphens)
  creditCard: /\b(?:\d{4}[- ]?){3}\d{4}\b|\b\d{13,19}\b/g,
  
  // US SSN: XXX-XX-XXXX
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  
  // Indian PAN (5 letters, 4 digits, 1 letter)
  pan: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/ig,
  
  // Indian GSTIN (2 digits, 5 letters, 4 digits, 1 letter, 1 digit, Z, 1 alphanumeric)
  gstin: /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/ig,
  
  // Passport (Indian & general formats: e.g. 1 letter followed by 7 or 8 digits, or 9 digit numbers)
  passport: /\b[A-Z][0-9]{7,8}\b|\b[0-9]{9}\b/ig,
  
  // General Phone Number (handles US, Indian, and general international formats)
  phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}\b|\b(?:\+91[\-\s]?)?[6789]\d{9}\b/g
};

// Date patterns (for DOB detection)
const DATE_PATTERNS = [
  /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g,
  /\b\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}\b/g,
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b/ig,
  /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/ig
];

// Keywords indicating a date is a Date of Birth (compiled once case-insensitively)
const DOB_KEYWORD_REGEX = /\b(?:born|birth|dob|d\.o\.b|date\s+of\s+birth|birthday|yob|year\s+of\s+birth)\b/i;

const NAME_TITLES = /^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Miss|Independent Director|Director|Prof\.?)\s+/i;

// Reused Immutable Objects to avoid recreation inside detectPII loop
const REGEX_ENTRIES = Object.entries(REGEX_PATTERNS);

const TITLE_STOPWORDS = new Set([
  'Chief', 'Director', 'Independent', 'Officer', 'Manager', 'President',
  'Executive', 'Financial', 'Operating', 'Secretary'
]);

/**
 * Generator function that yields chunks of text up to a target size.
 * Target chunk size set to 75,000 characters by default. This minimizes the total
 * number of nlp() document parses (which has high constant initialization time).
 * 
 * @param {string} text - The input document text
 * @param {number} targetSize - Target chunk size in characters
 * @returns {Generator<string>} Yields text chunks
 */
function* yieldNLPChunks(text, targetSize = 75000) {
  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start + targetSize);
    if (end === -1) {
      end = len;
    }
    yield text.slice(start, end);
    start = end + 1;
  }
}

/**
 * Detects all structured and unstructured PII in the input text.
 * Highly optimized for CPU cycles: uses character-scanning heuristics to bypass NLP,
 * runs index-based pointer scans to pre-filter lines, and performs single-pass NLP traversals.
 * 
 * @param {string} text - The raw document text
 * @returns {Object} Grouped sets of unique PII values
 */
export function detectPII(text) {
  const result = {
    email: new Set(),
    ip: new Set(),
    creditCard: new Set(),
    ssn: new Set(),
    pan: new Set(),
    gstin: new Set(),
    passport: new Set(),
    phone: new Set(),
    dob: new Set(),
    name: new Set(),
    company: new Set(),
    address: new Set()
  };

  if (!text || typeof text !== 'string') {
    return result;
  }

  // Request-local cache map to avoid duplicate name normalization Regex runs
  const normalizationCache = new Map();
  let totalNormalizationTime = 0;

  const cachedNormalizeName = (name) => {
    const normStart = performance.now();
    const cached = normalizationCache.get(name);
    if (cached !== undefined) {
      totalNormalizationTime += performance.now() - normStart;
      return cached;
    }

    const normalized = name
      .replace(NAME_TITLES, '')
      .replace(/[,.]+$/, '')
      .trim();

    normalizationCache.set(name, normalized);
    totalNormalizationTime += performance.now() - normStart;
    return normalized;
  };

  // Scans context for Date of Birth (DOB) within a chunk
  const detectChunkDOBs = (chunkText) => {
    for (const regex of DATE_PATTERNS) {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(chunkText)) !== null) {
        const dateString = match[0];
        const matchIndex = match.index;
        
        // Context window of 30 characters before and after
        const start = Math.max(0, matchIndex - 30);
        const end = Math.min(chunkText.length, matchIndex + dateString.length + 30);
        const context = chunkText.substring(start, end);
        
        // Optimized: pre-compiled regex test avoids calling toLowerCase() and creating strings
        const isDob = DOB_KEYWORD_REGEX.test(context);
        if (isDob) {
          result.dob.add(dateString.trim());
        }
      }
    }
  };

  // Performance timers
  let totalRegexTime = 0;
  let totalDobTime = 0;
  let totalHeuristicTime = 0;
  let totalNlpTime = 0;
  let totalChunks = 0;
  let skippedChunks = 0;
  let totalChunkSize = 0;
  let totalNlpParses = 0;
  let totalNlpParseTime = 0;
  const startTotal = performance.now();

  // Process text chunk-by-chunk (~75KB per chunk) to avoid heap limit crash and minimize parses
  for (const chunk of yieldNLPChunks(text, 75000)) {
    totalChunks++;
    totalChunkSize += chunk.length;

    // 1. Structured PII Detection (Regexes)
    const regexStart = performance.now();
    for (const [key, regex] of REGEX_ENTRIES) {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(chunk)) !== null) {
        result[key].add(match[0].trim());
      }
    }
    totalRegexTime += performance.now() - regexStart;

    // 2. DOB Detection
    const dobStart = performance.now();
    detectChunkDOBs(chunk);
    totalDobTime += performance.now() - dobStart;

    // 3. Heuristic Pre-Filtering for NLP (Zero-Allocation Character Code Scan)
    const heurStart = performance.now();
    let letterCount = 0;
    let digitCount = 0;
    let separatorCount = 0;
    let properNounCount = 0;
    let insideWord = false;
    let wordStart = -1;

    const len = chunk.length;
    for (let i = 0; i < len; i++) {
      const code = chunk.charCodeAt(i);
      
      // Check if letter (A-Z = 65-90, a-z = 97-122)
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        letterCount++;
        if (!insideWord) {
          insideWord = true;
          wordStart = i;
        }
      } else {
        // Check if digit (0-9 = 48-57)
        if (code >= 48 && code <= 57) {
          digitCount++;
        } else if (code === 45 || code === 61 || code === 124 || code === 42 || code === 43 || code === 95) {
          // Separators: - (45), = (61), | (124), * (42), + (43), _ (95)
          separatorCount++;
        }
        
        if (insideWord) {
          // Word ended. Check if first character was capitalized (65-90)
          const firstCode = chunk.charCodeAt(wordStart);
          if (firstCode >= 65 && firstCode <= 90) {
            properNounCount++;
          }
          insideWord = false;
        }
      }
    }
    if (insideWord) {
      const firstCode = chunk.charCodeAt(wordStart);
      if (firstCode >= 65 && firstCode <= 90) {
        properNounCount++;
      }
    }
    
    const letterRatio = letterCount / len;
    const separatorRatio = separatorCount / len;
    totalHeuristicTime += performance.now() - heurStart;

    // NLP Skip Heuristics:
    // - letterRatio < 0.35 -> mostly numerical tables/formatting.
    // - properNounCount < 3 -> no names/org entities exist in chunk.
    // - separatorRatio > 0.05 -> ASCII table borders/layout structure.
    if (letterRatio < 0.35 || properNounCount < 3 || separatorRatio > 0.05) {
      skippedChunks++;
      continue;
    }

    // 4. Unstructured PII Detection (Compromise NLP) with pointer-based line filtering
    const nlpStart = performance.now();
    let nlpText = '';
    let lineStart = 0;
    
    while (lineStart < len) {
      let lineEnd = chunk.indexOf('\n', lineStart);
      if (lineEnd === -1) {
        lineEnd = len;
      }
      
      // Fast raw character check: line must contain at least one capitalized word structure [A-Z][a-z]
      let hasProperNoun = false;
      for (let i = lineStart; i < lineEnd - 1; i++) {
        const code1 = chunk.charCodeAt(i);
        const code2 = chunk.charCodeAt(i + 1);
        if (code1 >= 65 && code1 <= 90 && code2 >= 97 && code2 <= 122) {
          if (i === lineStart) {
            hasProperNoun = true;
            break;
          } else {
            const prevCode = chunk.charCodeAt(i - 1);
            const isPrevAlpha = (prevCode >= 65 && prevCode <= 90) || (prevCode >= 97 && prevCode <= 122);
            if (!isPrevAlpha) {
              hasProperNoun = true;
              break;
            }
          }
        }
      }
      
      if (hasProperNoun) {
        nlpText += chunk.substring(lineStart, lineEnd) + '\n';
      }
      
      lineStart = lineEnd + 1;
    }

    if (nlpText.length > 0) {
      totalNlpParses++;
      const parseStart = performance.now();
      const doc = nlp(nlpText);
      totalNlpParseTime += performance.now() - parseStart;
      
      // Optimized: Single-pass traversal extracts all Person, Organization, and Place entities concurrently
      const entities = doc.match('(#Person+|#Organization+|#Place+)');
      entities.forEach(m => {
        const cleanedText = m.text().trim();
        if (cleanedText.length > 2) {
          if (m.has('#Person')) {
            const cleanedName = cachedNormalizeName(cleanedText);
            if (cleanedName.length > 2 && !cleanedName.includes('\n')) {
              result.name.add(cleanedName);
            }
          } else if (m.has('#Organization')) {
            if (cleanedText.length > 3 && !cleanedText.includes('\n') && !TITLE_STOPWORDS.has(cleanedText)) {
              result.company.add(cleanedText);
            }
          } else if (m.has('#Place')) {
            if (cleanedText.length > 3 && !cleanedText.includes('\n')) {
              result.address.add(cleanedText);
            }
          }
        }
      });
    }
    totalNlpTime += performance.now() - nlpStart;
  }

  const totalTime = performance.now() - startTotal;
  const avgChunkSize = totalChunks > 0 ? (totalChunkSize / totalChunks).toFixed(0) : 0;
  const avgNlpParseTime = totalNlpParses > 0 ? (totalNlpParseTime / totalNlpParses).toFixed(1) : 0;

  console.log(
    `\n==================================================\n` +
    `         detectPII PERFORMANCE PROFILE            \n` +
    `==================================================\n` +
    `Total Time:         ${totalTime.toFixed(1)} ms\n` +
    `Regex Scanning:     ${totalRegexTime.toFixed(1)} ms\n` +
    `DOB Detection:      ${totalDobTime.toFixed(1)} ms\n` +
    `Chunk Heuristics:   ${totalHeuristicTime.toFixed(1)} ms\n` +
    `NLP Processing:     ${totalNlpTime.toFixed(1)} ms\n` +
    `  ↳ NLP Parse Time: ${totalNlpParseTime.toFixed(1)} ms\n` +
    `Normalization:      ${totalNormalizationTime.toFixed(1)} ms\n` +
    `--------------------------------------------------\n` +
    `Chunks Processed:   ${totalChunks}\n` +
    `Chunks Skipped:     ${skippedChunks} (${((skippedChunks / totalChunks) * 100).toFixed(1)}% skipped)\n` +
    `Average Chunk Size: ${avgChunkSize} chars\n` +
    `NLP Document Parses:${totalNlpParses} / Avg: ${avgNlpParseTime} ms\n` +
    `==================================================\n`
  );

  return result;
}
