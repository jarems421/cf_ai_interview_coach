import { strFromU8, unzipSync } from "fflate";
import { HttpError } from "./http";

const maxResumeFileBytes = 5 * 1024 * 1024;

export type ResumeExtractResult = {
  text: string;
  fileName: string;
  fileType: string;
  characterCount: number;
  quality: "good" | "warning";
  warnings?: string[];
  pageCount?: number;
};

type ExtractedResumeText = {
  text: string;
  pageCount?: number;
};

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function getUnreadableRatio(value: string) {
  if (!value) {
    return 1;
  }

  const suspicious = Array.from(value).filter((char) => {
    const code = char.charCodeAt(0);
    return (
      (code < 32 && char !== "\n" && char !== "\t") ||
      code === 65533 ||
      (code >= 0xd800 && code <= 0xdfff) ||
      (code >= 0xe000 && code <= 0xf8ff)
    );
  }).length;

  return suspicious / value.length;
}

function assertReadableText(text: string) {
  const normalized = normalizeExtractedText(text);

  if (normalized.length < 40) {
    throw new HttpError(
      422,
      "I could not find enough readable text in that resume. Try DOCX/TXT or paste the CV text."
    );
  }

  if (getUnreadableRatio(normalized) > 0.08) {
    throw new HttpError(
      422,
      "That resume extracted as unreadable text. Try DOCX/TXT or paste the CV text."
    );
  }

  return normalized;
}

function ensurePdfRuntimeGlobals() {
  const globalScope = globalThis as unknown as Record<string, unknown>;

  if (!globalScope.DOMMatrix) {
    globalScope.DOMMatrix = class {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;

      multiplySelf() {
        return this;
      }

      preMultiplySelf() {
        return this;
      }

      translateSelf() {
        return this;
      }

      scaleSelf() {
        return this;
      }

      rotateSelf() {
        return this;
      }
    };
  }
}

async function extractPdfText(buffer: ArrayBuffer): Promise<ExtractedResumeText> {
  ensurePdfRuntimeGlobals();
  try {
    const [pdfjs, pdfWorker] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.mjs")
    ]);
    (globalThis as unknown as Record<string, unknown>).pdfjsWorker = pdfWorker;

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useSystemFonts: true
    } as object);
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) =>
            "str" in item && typeof item.str === "string" ? item.str : ""
          )
          .join(" ")
      );
    }

    const pageCount = pdf.numPages;
    await pdf.destroy();
    return {
      text: pages.join("\n\n"),
      pageCount
    };
  } catch {
    throw new HttpError(
      422,
      "That PDF could not be parsed. Try DOCX/TXT or paste the CV text."
    );
  }
}

function stripXml(value: string) {
  return value
    .replace(/<w:tab\/>/g, " ")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:tc>/g, " ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractDocxText(buffer: ArrayBuffer): ExtractedResumeText {
  try {
    const files = unzipSync(new Uint8Array(buffer));
    const documentNames = Object.keys(files).filter(
      (name) =>
        name === "word/document.xml" ||
        /^word\/(header|footer)\d+\.xml$/.test(name)
    );

    if (documentNames.length === 0) {
      throw new Error("Missing DOCX document XML.");
    }

    return {
      text: documentNames
        .map((name) => stripXml(strFromU8(files[name])))
        .join("\n\n")
    };
  } catch {
    throw new HttpError(
      422,
      "That DOCX could not be parsed. Try PDF/TXT or paste the CV text."
    );
  }
}

export async function extractResumeFile(file: File): Promise<ResumeExtractResult> {
  if (file.size > maxResumeFileBytes) {
    throw new HttpError(400, "Resume file must be 5 MB or smaller.");
  }

  const extension = getExtension(file.name);
  const buffer = await file.arrayBuffer();
  let extracted: ExtractedResumeText;

  if (extension === "txt" || extension === "md") {
    extracted = { text: new TextDecoder().decode(buffer) };
  } else if (extension === "pdf") {
    extracted = await extractPdfText(buffer);
  } else if (extension === "docx") {
    extracted = extractDocxText(buffer);
  } else {
    throw new HttpError(400, "Upload a PDF, DOCX, TXT, or Markdown resume.");
  }

  const normalized = assertReadableText(extracted.text);
  const quality = normalized.length < 600 ? "warning" : "good";
  const warnings =
    quality === "warning"
      ? ["Extracted resume text is short. Review it before starting tailored practice."]
      : undefined;

  return {
    text: normalized,
    fileName: file.name,
    fileType: extension || file.type || "unknown",
    characterCount: normalized.length,
    quality,
    warnings,
    pageCount: extracted.pageCount
  };
}
