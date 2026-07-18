import { faker } from '@faker-js/faker';

// Helper to escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Deterministic hash function mapping string to a 32-bit positive integer seed.
 * This guarantees the seed is stable across restarts for the same PII string.
 * 
 * @param {string} str - The PII string
 * @returns {number} 32-bit positive integer hash
 */
function getStringSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Generates a realistic fake alternative for a given PII value based on its type.
 * Seeds faker deterministically to maintain consistency.
 * 
 * @param {string} originalValue - The original PII string
 * @param {string} type - The category of PII (e.g. 'email', 'name', 'phone')
 * @returns {string} Realistic fake replacement
 */
function generateFakeValue(originalValue, type) {
  const seed = getStringSeed(originalValue);
  faker.seed(seed);

  switch (type) {
    case 'email':
      return faker.internet.email();
    case 'ip':
      return faker.internet.ip();
    case 'creditCard':
      return faker.finance.creditCardNumber();
    case 'ssn':
      // Safe replacement using the recommended string template regex
      return '###-##-####'.replace(/#/g, () => faker.string.numeric());
    case 'pan':
      // Indian PAN: 5 uppercase letters, 4 digits, 1 uppercase letter
      return '?????####?'.replace(/\?/g, () => faker.string.alpha().toUpperCase()).replace(/#/g, () => faker.string.numeric());
    case 'gstin':
      // Indian GSTIN: 2 digits, 5 uppercase letters, 4 digits, 1 uppercase letter, 1 digit, 'Z', 1 alphanumeric
      const prefix = '##?????####?'.replace(/#/g, () => faker.string.numeric()).replace(/\?/g, () => faker.string.alpha().toUpperCase());
      const suffix = '?Z?'.replace(/\?/g, () => faker.string.alphanumeric().toUpperCase());
      return prefix + suffix;
    case 'phone':
      if (originalValue.includes('+91')) {
        return '+91 9########'.replace(/#/g, () => faker.string.numeric());
      }
      return '+1 (###) ###-####'.replace(/#/g, () => faker.string.numeric());
    case 'dob':
      // Try to preserve original date format style
      const birthDate = faker.date.birthdate({ min: 18, max: 80, mode: 'age' });
      if (originalValue.includes('/')) {
        return birthDate.toLocaleDateString('en-US');
      } else if (originalValue.includes('-')) {
        return birthDate.toISOString().split('T')[0];
      }
      return birthDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    case 'name':
      return faker.person.fullName();
    case 'company':
      return faker.company.name();
    case 'address':
      return `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state()} ${faker.location.zipCode()}`;
    case 'passport':
      // Passport: 1 uppercase letter followed by 7 digits
      return '?#######'.replace(/\?/g, () => faker.string.alpha().toUpperCase()).replace(/#/g, () => faker.string.numeric());
    default:
      return `[REDACTED_${type.toUpperCase()}]`;
  }
}

/**
 * Performs PII redaction on the text by replacing all detected entities.
 * Optimizes memory by executing a single-pass global replace rather than O(N) iterative replacements.
 * 
 * @param {string} text - The input plain text
 * @param {Object} detectedEntities - Grouped sets of unique PII values from detectPII
 * @returns {Object} { redactedText, lookupTable, stats }
 */
export function redactText(text, detectedEntities) {
  const lookupTable = {};
  const stats = {};

  // Compile a flat list of originalValue -> type mappings
  const flatMappings = [];
  
  for (const [type, set] of Object.entries(detectedEntities)) {
    stats[type] = set.size;
    for (const val of set) {
      if (val && val.trim().length > 0) {
        flatMappings.push({ original: val, type });
      }
    }
  }

  if (flatMappings.length === 0) {
    return {
      redactedText: text,
      lookupTable,
      stats
    };
  }

  // Sort flatMappings by length of the original string in descending order.
  // Crucial to prevent partial replacements (e.g. replacing "John" in "John Doe" first).
  flatMappings.sort((a, b) => b.original.length - a.original.length);

  // Generate consistent deterministic fake values for each unique original value
  for (const item of flatMappings) {
    if (!lookupTable[item.original]) {
      lookupTable[item.original] = {
        fake: generateFakeValue(item.original, item.type),
        type: item.type
      };
    }
  }

  // Build a single global regular expression containing all search terms as alternation (A|B|C|...)
  // Sorted descending by length, which guarantees correct match order.
  const sortedOriginals = Object.keys(lookupTable).sort((a, b) => b.length - a.length);
  const escapedPatterns = sortedOriginals.map(escapeRegExp);
  const combinedRegex = new RegExp(escapedPatterns.join('|'), 'g');

  // Single-pass replacement avoids O(N) intermediate string copying and potential memory limit crash
  const redactedText = text.replace(combinedRegex, (match) => {
    return lookupTable[match]?.fake || match;
  });

  return {
    redactedText,
    lookupTable,
    stats
  };
}
