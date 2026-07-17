import { Document, Packer, Paragraph, TextRun } from 'docx';

/**
 * Generates a formatted .docx document from plain text.
 * @param {string} text - The redacted plain text
 * @returns {Promise<Buffer>} The .docx binary buffer
 */
export async function generateDocx(text) {
  // Split text into lines and map to Paragraph components
  const lines = text.split(/\r?\n/);
  
  const paragraphs = lines.map(line => {
    // Return an empty paragraph for empty lines to preserve vertical spacing
    if (line.trim().length === 0) {
      return new Paragraph({
        spacing: { after: 120 }
      });
    }

    return new Paragraph({
      children: [
        new TextRun({
          text: line,
          font: 'Calibri',
          size: 22 // 11pt font size
        })
      ],
      spacing: {
        after: 120 // 6pt spacing after each paragraph
      }
    });
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs
      }
    ]
  });

  // Compile document to a binary buffer
  const buffer = await Packer.toBuffer(doc);
  return buffer;
}
