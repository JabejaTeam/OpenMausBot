// Fork: which card a coordinate_bots assignment is about. A code agent keeps
// one work thread per card, so a follow-up lands where that card's code and
// decisions are already in view, and another card runs beside it.

/** The first roadmap card an assignment names ("kaart 2a1ceef4…", also
 * written glued, "kaart2a1ceef4", or in English "card"): its 8-character id,
 * lowercase. Undefined when it names none. */
export function workTopicOf(message: string): string | undefined {
  return /\b(?:kaart|card)\s*([0-9a-f]{8})(?![0-9a-z])/i.exec(message)?.[1]?.toLowerCase()
    ?? /\b(?:kaart|card)\s*([0-9a-f]{8})-[0-9a-f]{4}-/i.exec(message)?.[1]?.toLowerCase();
}
