import { Document, Packer, Paragraph, TextRun } from 'docx';


export async function generateDocx(text) {

  const lines = text.split(/\r?\n/);
  
  const paragraphs = lines.map(line => {

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
          size: 22 
        })
      ],
      spacing: {
        after: 120 
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

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}
