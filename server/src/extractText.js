import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import unzipper from 'unzipper';
import sax from 'sax';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

// Define the path to the PDF.js worker using legacy builds for Node compatibility.
// Resolves dynamically relative to this script location to allow correct module resolution in Node.js ESM.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

/**
 * Parses an XML stream from a DOCX entry using SAX.
 * Extracts text inside <w:t> tags and formats breaks/tabs/paragraphs.
 * Ignores namespace prefixes dynamically and recovers gracefully from errors.
 * 
 * @param {Readable} stream - The XML file read stream
 * @returns {Promise<string>} The parsed plain text
 */
function parseXmlStream(stream) {
  return new Promise((resolve, reject) => {
    // Create strict XML parser stream
    const parser = sax.createStream(true, { lowercase: true });
    let textContent = '';
    let currentText = '';
    let inText = false;

    parser.on('opentag', (node) => {
      // Split by colon to ignore namespace prefixes (e.g. w:t -> t)
      const tagName = node.name.split(':').pop();
      if (tagName === 't') {
        inText = true;
        currentText = '';
      }
    });

    parser.on('closetag', (name) => {
      const tagName = name.split(':').pop();
      if (tagName === 't') {
        inText = false;
        textContent += currentText;
      } else if (tagName === 'p' || tagName === 'br' || tagName === 'tr') {
        // Correctly handle paragraphs, line breaks, and table rows by appending newline
        textContent += '\n';
      } else if (tagName === 'tc') {
        // Handle table cell columns by appending a tab character
        textContent += '\t';
      }
    });

    parser.on('text', (text) => {
      if (inText) {
        currentText += text;
      }
    });

    parser.on('error', (err) => {
      // Log validation warning and resume stream parsing to avoid crashing on namespace issues
      console.warn('XML Parser Warning:', err.message);
      parser._parser.error = null;
      parser._parser.resume();
    });

    parser.on('end', () => {
      resolve(textContent);
    });

    stream.on('error', (err) => {
      reject(err);
    });

    stream.pipe(parser);
  });
}

/**
 * Extracts plain text from document buffers (PDF, DOCX, TXT).
 * Optimized to stream DOCX XML parts dynamically using unzipper and sax,
 * and page-by-page streaming extraction for PDF using pdfjs-dist.
 * 
 * @param {Buffer} buffer - The file binary buffer
 * @param {string} mimeType - The file MIME type
 * @param {string} originalName - The original name of the file
 * @returns {Promise<string>} The extracted plain text
 */
export async function extractText(buffer, mimeType, originalName = '') {
  const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 originalName.toLowerCase().endsWith('.docx');
  const isPdf = mimeType === 'application/pdf' || 
                originalName.toLowerCase().endsWith('.pdf');

  try {
    if (isDocx) {
      console.log('Extracting DOCX text using streaming ZIP/XML parser...');
      
      // Open ZIP Central Directory directly from the buffer without unzipping to disk
      const directory = await unzipper.Open.buffer(buffer);
      
      let documentText = '';
      let headerText = '';
      let footerText = '';
      let notesText = '';
      let commentsText = '';

      // Stream each XML part to extract text content sequentially
      for (const entry of directory.files) {
        const path = entry.path;

        const isDocument = path === 'word/document.xml';
        const isHeader = path.startsWith('word/header') && path.endsWith('.xml');
        const isFooter = path.startsWith('word/footer') && path.endsWith('.xml');
        const isFootnotes = path === 'word/footnotes.xml' || path === 'word/endnotes.xml';
        const isComments = path === 'word/comments.xml';

        if (isDocument || isHeader || isFooter || isFootnotes || isComments) {
          const entryStream = entry.stream();
          const parsedText = await parseXmlStream(entryStream);

          if (isDocument) {
            documentText += parsedText;
          } else if (isHeader) {
            headerText += parsedText + '\n';
          } else if (isFooter) {
            footerText += parsedText + '\n';
          } else if (isFootnotes) {
            notesText += parsedText + '\n';
          } else if (isComments) {
            commentsText += parsedText + '\n';
          }
        }
      }

      // Concatenate content cleanly to represent the full document
      const resultText = [
        headerText.trim(),
        documentText.trim(),
        notesText.trim(),
        commentsText.trim(),
        footerText.trim()
      ].filter(section => section.length > 0).join('\n\n');

      return resultText;

    } else if (isPdf) {
      console.log('Extracting PDF text page-by-page using pdfjs-dist...');
      
      // Resolve path to server/node_modules/pdfjs-dist/standard_fonts
      const fontsPath = path.resolve(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts');
      
      // Load document from Uint8Array to prevent entire file buffering overhead
      const loadingTask = pdfjsLib.getDocument({ 
        data: new Uint8Array(buffer),
        // Point to local standard font data to prevent warnings/errors on standard fonts
        standardFontDataUrl: pathToFileURL(fontsPath).href + '/'
      });
      const pdfDoc = await loadingTask.promise;
      const numPages = pdfDoc.numPages;
      let fullText = '';
      
      // Sequentially load, parse, and release each page to avoid memory pileup
      for (let i = 1; i <= numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        
        let lastY = null;
        let pageText = '';
        
        for (const item of textContent.items) {
          // If transform exists, check y-coordinate to preserve line ordering
          const y = item.transform ? item.transform[5] : null;
          if (lastY === y || lastY === null || y === null) {
            pageText += item.str;
          } else {
            pageText += '\n' + item.str;
          }
          lastY = y;
        }
        
        fullText += pageText.trim() + '\n\n';
        
        // Clean up the page structure immediately so it gets garbage collected
        page.cleanup();
      }
      
      // Clean up the document structures and free remaining PDF objects
      await pdfDoc.cleanup();
      
      return fullText.trim();
      
    } else {
      console.log('Extracting raw text from plain text buffer...');
      return buffer.toString('utf-8');
    }
  } catch (error) {
    throw new Error(`Failed to extract text from document: ${error.message}`);
  }
}
