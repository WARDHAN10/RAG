import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import WordExtractor from "word-extractor";

const MAX_PDF_PAGES = 250;
const MAX_EXTRACTED_CHARACTERS = 3_000_000;

export class DocumentTextExtractionError extends Error {}

function enforceTextLimit(text: string) {
  if (text.length > MAX_EXTRACTED_CHARACTERS) {
    throw new DocumentTextExtractionError(
      "This document contains too much text. Split it into smaller files.",
    );
  }
  return text;
}

async function extractPdfText(data: Uint8Array) {
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
  });

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new DocumentTextExtractionError(
        `PDFs must have ${MAX_PDF_PAGES} pages or fewer.`,
      );
    }

    const pages: string[] = [];
    let totalCharacters = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter((item) => "str" in item && typeof item.str === "string")
        .map((item) => {
          if (!("str" in item) || typeof item.str !== "string") return "";
          return item.str + (item.hasEOL ? "\n" : " ");
        })
        .join("");
      page.cleanup();

      totalCharacters += pageText.length;
      if (totalCharacters > MAX_EXTRACTED_CHARACTERS) {
        throw new DocumentTextExtractionError(
          "This document contains too much text. Split it into smaller files.",
        );
      }
      pages.push(pageText);
    }

    return pages.join("\n").trim();
  } catch (error) {
    if (error instanceof DocumentTextExtractionError) throw error;
    throw new DocumentTextExtractionError(
      "Could not read this PDF. It may be damaged or password-protected.",
    );
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractDocumentText(filename: string, bytes: Uint8Array) {
  const extension = filename.toLowerCase().split(".").pop();

  if (extension === "txt") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new DocumentTextExtractionError(
        "Could not read this .txt file as UTF-8 text.",
      );
    }
    if (text.includes(String.fromCharCode(0))) {
      throw new DocumentTextExtractionError(
        "This file does not appear to be plain text.",
      );
    }
    return enforceTextLimit(text);
  }

  if (extension === "doc") {
    let document: Awaited<ReturnType<WordExtractor["extract"]>>;
    try {
      document = await new WordExtractor().extract(Buffer.from(bytes));
    } catch {
      throw new DocumentTextExtractionError(
        "Could not read this Word file. Upload a valid .doc document.",
      );
    }
    return enforceTextLimit(document.getBody().trim());
  }

  if (extension === "pdf") {
    const text = await extractPdfText(bytes);
    if (!text) {
      throw new DocumentTextExtractionError(
        "No selectable text was found in this PDF. Scanned PDFs need OCR, which is not included yet.",
      );
    }
    return text;
  }

  throw new DocumentTextExtractionError("Only .txt, .doc, and .pdf files are supported.");
}
