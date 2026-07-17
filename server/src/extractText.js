import pdf from 'pdf-parse';
import mammoth from 'mammoth';

/**
 * Extracts raw text from a PDF or DOCX file buffer.
 * @param {Buffer} buffer - File buffer from multer
 * @param {string} mimeType - The mime type of the file
 * @param {string} originalName - Original filename for fallback extension check
 * @returns {Promise<string>} Extracted plain text
 */
export async function extractText(buffer, mimeType, originalName = '') {
  const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 originalName.toLowerCase().endsWith('.docx');
  const isPdf = mimeType === 'application/pdf' || 
                originalName.toLowerCase().endsWith('.pdf');

  if (isDocx) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } else if (isPdf) {
    const data = await pdf(buffer);
    return data.text;
  } else {
    // If it's a plain text file, we can just decode it as a fallback
    return buffer.toString('utf-8');
  }
}
