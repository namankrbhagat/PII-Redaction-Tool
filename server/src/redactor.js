import { faker } from '@faker-js/faker';

// Helper to escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generates a realistic fake alternative for a given PII value based on its type.
 * @param {string} originalValue - The original PII string
 * @param {string} type - The category of PII (e.g. 'email', 'name', 'phone')
 * @returns {string} Realistic fake replacement
 */
function generateFakeValue(originalValue, type) {
  // Use a fixed seed based on the original value to make the replacement consistent
  // but randomized across different runs. We can seed faker if we want, or just let faker handle it.
  // We can seed faker with a hash of the original value for true mathematical determinism,
  // but standard faker calls are fine since we use a lookup table per request.
  
  switch (type) {
    case 'email':
      return faker.internet.email();
    case 'ip':
      return faker.internet.ip();
    case 'creditCard':
      return faker.finance.creditCardNumber();
    case 'ssn':
      return faker.helpers.replaceSymbolWithNumber('###-##-####');
    case 'pan':
      // Indian PAN: 5 uppercase letters, 4 digits, 1 uppercase letter
      return faker.helpers.replaceSymbols('?????####?').toUpperCase();
    case 'gstin':
      // Indian GSTIN: 2 digits, 5 uppercase letters, 4 digits, 1 uppercase letter, 1 digit, 'Z', 1 alphanumeric
      return faker.helpers.replaceSymbols('##?????####??Z?').toUpperCase();
    case 'phone':
      if (originalValue.includes('+91')) {
        return faker.helpers.replaceSymbolWithNumber('+91 9########');
      }
      return faker.helpers.replaceSymbolWithNumber('+1 (###) ###-####');
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
      // Passport example: 1 letter followed by 7 digits
      return faker.helpers.replaceSymbols('?#######').toUpperCase();
    default:
      return `[REDACTED_${type.toUpperCase()}]`;
  }
}

/**
 * Performs PII redaction on the text by replacing all detected entities with consistent fake data.
 * @param {string} text - The input plain text
 * @param {Object} detectedEntities - Grouped sets of unique PII values from detectPII
 * @returns {Object} { redactedText, lookupTable, stats }
 */
export function redactText(text, detectedEntities) {
  let redactedText = text;
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

  // Sort flatMappings by length of the original string in descending order.
  // This is crucial to prevent partial replacements (e.g. replacing "John" in "John Doe" first).
  flatMappings.sort((a, b) => b.original.length - a.original.length);

  // First pass: Generate consistent fake values for each unique original value
  for (const item of flatMappings) {
    if (!lookupTable[item.original]) {
      lookupTable[item.original] = {
        fake: generateFakeValue(item.original, item.type),
        type: item.type
      };
    }
  }

  // Second pass: Perform search and replace in the text
  // We recreate sorted keys list to make sure we replace in descending length order
  const sortedOriginals = Object.keys(lookupTable).sort((a, b) => b.length - a.length);

  for (const original of sortedOriginals) {
    const fake = lookupTable[original].fake;
    const escaped = escapeRegExp(original);
    // Global replacement using regex
    const regex = new RegExp(escaped, 'g');
    redactedText = redactedText.replace(regex, fake);
  }

  return {
    redactedText,
    lookupTable,
    stats
  };
}
