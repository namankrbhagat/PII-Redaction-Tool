import pdf from 'pdf-parse';
import mammoth from 'mammoth';


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
    return buffer.toString('utf-8');
  }
}
