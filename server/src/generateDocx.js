import { Document, Packer, Paragraph, TextRun } from 'docx';

/**
 * Generates a downloadable DOCX file buffer from the redacted plain text.
 * Optimized to iterate lines via index scanning instead of calling split() on the entire string,
 * preventing massive array allocations and high heap usage.
 * 
 * @param {string} text - The redacted plain text
 * @returns {Promise<Buffer>} The DOCX binary buffer
 */
export async function generateDocx(text) {
  const paragraphs = [];
  
  if (!text || typeof text !== 'string') {
    return Buffer.alloc(0);
  }

  // Iterate over paragraphs using index scanning rather than text.split(/\r?\n/)
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) {
      end = text.length;
    }
    
    // Slice only the current line
    const line = text.slice(start, end);
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      paragraphs.push(new Paragraph({
        spacing: { after: 120 }
      }));
    } else {
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({
            text: line,
            font: 'Calibri',
            size: 22 
          })
        ],
        spacing: {
          after: 120 
        }
      }));
    }

    start = end + 1;
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs
      }
    ]
  });

  try {
    const buffer = await Packer.toBuffer(doc);
    
    // Explicitly release paragraph references
    paragraphs.length = 0;
    
    return buffer;
  } catch (error) {
    throw new Error(`Failed to bundle DOCX document: ${error.message}`);
  }
}
