import fs from 'fs';
import { extractText } from './src/extractText.js';
import { detectPII } from './src/detectors.js';
import { redactText } from './src/redactor.js';
import { generateDocx } from './src/generateDocx.js';

async function run() {
  try {
    const inputPath = 'C:\\Users\\naman\\Downloads\\Red Herring Prospectus.docx';
    const outputPath = 'C:\\Users\\naman\\Downloads\\redacted_Red Herring Prospectus.docx';

    console.log(`Reading input document: ${inputPath}...`);
    const fileBuffer = fs.readFileSync(inputPath);
    
    console.log('Extracting text...');
    const rawText = await extractText(fileBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Red Herring Prospectus.docx');
    
    console.log('Detecting PII...');
    const detected = detectPII(rawText);
    
    console.log('Redacting and substituting fake alternatives consistently...');
    const { redactedText, stats } = redactText(rawText, detected);
    
    console.log('Redaction statistics:');
    console.log(stats);
    
    console.log('Generating redacted .docx document...');
    const docxBuffer = await generateDocx(redactedText);
    
    fs.writeFileSync(outputPath, docxBuffer);
    console.log(`Successfully saved redacted document to: ${outputPath}`);

  } catch (error) {
    console.error('CMD Redaction failed:', error);
  }
}

run();
