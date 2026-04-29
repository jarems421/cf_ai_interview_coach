import { decompressSync, strFromU8, unzipSync } from "fflate";

const maxResumeFileBytes = 5 * 1024 * 1024;

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodePdfLiteral(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function extractPdfTextFromSource(source: string) {
  const textRuns: string[] = [];
  const literalPattern = /\((?:\\.|[^\\)])*\)\s*Tj|\((?:\\.|[^\\)])*\)/g;
  let match: RegExpExecArray | null;

  while ((match = literalPattern.exec(source)) !== null) {
    const literal = match[0].match(/\((?:\\.|[^\\)])*\)/)?.[0];
    if (literal) {
      textRuns.push(decodePdfLiteral(literal.slice(1, -1)));
    }
  }

  return textRuns.join(" ");
}

function extractPdfText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const decoded = new TextDecoder("latin1").decode(bytes);
  const chunks = [decoded];
  const streamPattern = /<<(?:.|\n|\r)*?>>\s*stream\r?\n/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(decoded)) !== null) {
    const streamStart = streamPattern.lastIndex;
    const streamEnd = decoded.indexOf("endstream", streamStart);

    if (streamEnd === -1) {
      break;
    }

    const dictionary = match[0];
    if (dictionary.includes("FlateDecode")) {
      try {
        const streamBytes = bytes.slice(streamStart, streamEnd);
        const inflated = decompressSync(streamBytes);
        chunks.push(strFromU8(inflated));
      } catch {
        // Best-effort PDF text extraction; uncompressed text is still scanned.
      }
    }

    streamPattern.lastIndex = streamEnd + "endstream".length;
  }

  return chunks.map(extractPdfTextFromSource).join("\n\n");
}

function extractDocxText(buffer: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const documentNames = Object.keys(files).filter(
    (name) =>
      name === "word/document.xml" ||
      /^word\/(header|footer)\d+\.xml$/.test(name)
  );
  const parser = new DOMParser();

  return documentNames
    .map((name) => {
      const xml = strFromU8(files[name]);
      const doc = parser.parseFromString(xml, "application/xml");
      return Array.from(doc.getElementsByTagName("w:t"))
        .map((node) => node.textContent ?? "")
        .join(" ");
    })
    .join("\n\n");
}

export async function extractResumeText(file: File) {
  if (file.size > maxResumeFileBytes) {
    throw new Error("Resume file must be 5 MB or smaller.");
  }

  const extension = getExtension(file.name);
  let text = "";

  if (extension === "txt" || extension === "md") {
    text = await file.text();
  } else if (extension === "pdf") {
    text = extractPdfText(await file.arrayBuffer());
  } else if (extension === "docx") {
    text = extractDocxText(await file.arrayBuffer());
  } else {
    throw new Error("Upload a PDF, DOCX, TXT, or Markdown resume.");
  }

  const normalized = normalizeExtractedText(text);
  if (!normalized) {
    throw new Error("I could not find readable text in that resume file.");
  }

  return normalized;
}
