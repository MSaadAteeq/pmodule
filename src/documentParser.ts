/**
 * Extract text from PDF or Word (.docx) for use as interview reference.
 */

// PDF.js worker required when using pdfjs-dist with a bundler (e.g. Vite)
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return extractTextFromPdf(file);
  if (name.endsWith(".docx") || name.endsWith(".doc")) return extractTextFromDocx(file);
  throw new Error("Unsupported format. Use PDF or Word (.docx).");
}

async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  (pdfjsLib as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const parts: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: unknown) => (item && typeof (item as { str?: string }).str === "string" ? (item as { str: string }).str : ""))
      .join(" ");
    parts.push(text);
  }
  return parts.join("\n\n").replace(/\s+/g, " ").trim();
}

async function extractTextFromDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.replace(/\s+/g, " ").trim();
}
