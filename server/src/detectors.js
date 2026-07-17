import nlp from 'compromise';

// Regex patterns for structured PII
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

// Keywords indicating a date is a Date of Birth
const DOB_KEYWORDS = ['born', 'birth', 'dob', 'd.o.b', 'date of birth', 'birthday', 'yob', 'year of birth'];

/**
 * Scans text and extracts context-aware Date of Birth (DOB) strings.
 * @param {string} text - The input text
 * @returns {Set<string>} Set of DOB strings
 */
function detectDOBs(text) {
  const dobs = new Set();
  
  for (const regex of DATE_PATTERNS) {
    let match;
    // Reset regex index
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      const dateString = match[0];
      const matchIndex = match.index;
      
      // Look at the context window (30 chars before and 30 chars after the match)
      const start = Math.max(0, matchIndex - 30);
      const end = Math.min(text.length, matchIndex + dateString.length + 30);
      const context = text.slice(start, end).toLowerCase();
      
      const isDob = DOB_KEYWORDS.some(keyword => context.includes(keyword));
      if (isDob) {
        dobs.add(dateString);
      }
    }
  }
  
  return dobs;
}
const NAME_TITLES = /^(Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Miss|Independent Director|Director|Prof\.?)\s+/i;

function normalizeName(name) {
  return name
    .replace(NAME_TITLES, '')
    .replace(/[,.]+$/, '')
    .trim();
}

/**
 * Detects all structured and unstructured PII in the input text.
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
    phone: new Set(),
    dob: new Set(),
    name: new Set(),
    company: new Set(),
    address: new Set()
  };

  // 1. Structured PII Detection (Regex)
  for (const [key, regex] of Object.entries(REGEX_PATTERNS)) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      // Avoid duplicate matching if it overlaps or is invalid
      result[key].add(match[0].trim());
    }
  }

  // 2. Context-aware DOB detection
  const detectedDobs = detectDOBs(text);
  for (const dob of detectedDobs) {
    result.dob.add(dob.trim());
  }

  // 3. Unstructured PII Detection (NLP using compromise)
  const doc = nlp(text);
  
  // Extract People Names
  doc.people().out('array').forEach(name => {
    const cleaned = normalizeName(name.trim());
    if (cleaned.length > 2 && !cleaned.includes('\n')) {
      result.name.add(cleaned);
    }
  });

  // Extract Company/Organization Names
  const TITLE_STOPWORDS = new Set([
  'Chief', 'Director', 'Independent', 'Officer', 'Manager', 'President',
  'Executive', 'Financial', 'Operating', 'Secretary'
  ]);

  doc.organizations().out('array').forEach(company => {
    const cleaned = company.trim();
    if (cleaned.length > 3 && !cleaned.includes('\n') && !TITLE_STOPWORDS.has(cleaned)) {
      result.company.add(cleaned);
    }
  });

  // Extract Addresses/Places
  doc.places().out('array').forEach(place => {
    const cleaned = place.trim();
    if (cleaned.length > 3 && !cleaned.includes('\n')) {
      result.address.add(cleaned);
    }
  });

  return result;
}
