export type UploadKind = "image" | "pdf" | "doc" | "sheet" | "text" | "other";

export type UploadRead = {
  name: string;
  kind: UploadKind;
  text: string;
  previewUrl?: string;
};

export async function readUpload(file: File): Promise<UploadRead> {
  const name = file.name || "archivo";
  const type = (file.type || "").toLowerCase();
  const lower = name.toLowerCase();
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  if (type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(lower)) {
    return { name, kind: "image", text: name.replace(/\.[^.]+$/, " ").replace(/[_-]+/g, " "), previewUrl: URL.createObjectURL(file) };
  }

  if (type.startsWith("text/") || /\.(txt|csv|md|html)$/i.test(lower)) {
    return { name, kind: "text", text: `${name}\n${await file.text()}` };
  }

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const xml = await unzipXmlText(bytes);
    const kind: UploadKind = lower.endsWith(".xlsx") || xml.includes("sharedStrings") ? "sheet" : "doc";
    return { name, kind, text: `${name}\n${xml}` };
  }

  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44) {
    return { name, kind: "pdf", text: `${name}\n${pdfStrings(bytes)}` };
  }

  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    return { name, kind: "doc", text: `${name}\n${oleStrings(bytes)}` };
  }

  return { name, kind: "other", text: name.replace(/[_-]+/g, " ") };
}

function pdfStrings(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const chunks: string[] = [];
  const paren = raw.matchAll(/\(([^)]{3,80})\)/g);
  for (const m of paren) {
    const s = m[1].replace(/\\[nrt]/g, " ").trim();
    if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(s)) chunks.push(s);
  }
  return chunks.join(" ");
}

function oleStrings(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const parts = raw.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ .'-]{2,40}/g) ?? [];
  return parts.join(" ");
}

async function unzipXmlText(bytes: Uint8Array): Promise<string> {
  const texts: string[] = [];
  let i = 0;
  while (i + 30 < bytes.length) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) {
      i += 1;
      continue;
    }
    const method = bytes[i + 8] | (bytes[i + 9] << 8);
    const comp = bytes[i + 18] | (bytes[i + 19] << 8) | (bytes[i + 20] << 16) | (bytes[i + 21] << 24);
    const nameLen = bytes[i + 26] | (bytes[i + 27] << 8);
    const extra = bytes[i + 28] | (bytes[i + 29] << 8);
    const start = i + 30;
    const fileName = new TextDecoder().decode(bytes.subarray(start, start + nameLen));
    const dataAt = start + nameLen + extra;
    const blob = bytes.subarray(dataAt, dataAt + Math.max(0, comp));
    i = dataAt + Math.max(1, comp);
    if (!/\.xml$/i.test(fileName)) continue;
    if (!/document\.xml|sharedStrings|sheet\d|workbook|core\.xml/i.test(fileName)) continue;
    try {
      const xml = await inflate(blob, method);
      texts.push(xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    } catch {
      /* skip broken entry */
    }
  }
  return texts.join(" ");
}

async function inflate(data: Uint8Array, method: number): Promise<string> {
  if (method === 0) return new TextDecoder().decode(data);
  if (method !== 8) return "";
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buf);
}
