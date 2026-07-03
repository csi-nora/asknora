import { Injectable } from '@angular/core';
import { KbDocument, TextChunk } from '../models';

@Injectable({ providedIn: 'root' })
export class ChunkerService {

  chunk(doc: KbDocument, chunkSize = 400, overlap = 60): TextChunk[] {
    const text = doc.content;
    if (!text || text.length === 0) return [];

    const chunks: TextChunk[] = [];
    let start = 0;
    let idx = 0;

    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);

      // Try to break at sentence boundary
      if (end < text.length) {
        const breakPoints = ['. ', '.\n', '? ', '! ', '\n\n', '\n'];
        let bestBreak = end;
        for (const bp of breakPoints) {
          const pos = text.lastIndexOf(bp, end);
          if (pos > start + chunkSize * 0.5) { bestBreak = pos + bp.length; break; }
        }
        end = bestBreak;
      }

      const content = text.slice(start, end).trim();
      if (content.length > 30) {
        chunks.push({
          id:          `${doc.id}-${idx++}`,
          docId:       doc.id,
          docName:     doc.name,
          content,
          sensitivity: doc.sensitivity
        });
      }
      start = Math.max(start + 1, end - overlap);
    }
    return chunks;
  }
}
