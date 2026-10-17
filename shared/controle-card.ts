// Jabeja fork: the controle card (server/controle-card.ts, src/components/ControleCard.tsx).

/** What a controle message stores: only which client; the card reads the rest live. */
export interface ControleCardData {
  clientId: string;
}

/** Where the change is in the new screenshot, in pixels of that screenshot. */
export interface ControleKader {
  x: number;
  y: number;
  b: number;
  h: number;
  breedte: number;
  hoogte: number;
}

/** One screenshot of a change, to page through. */
export interface ControleBeeld {
  /** "huurvloot → huur" */
  plek: string;
  scherm: string;
  soort: string;
  voorUrl: string | null;
  naUrl: string;
  kader: ControleKader | null;
}

/** The roadmap card a change belongs to: what it asked ("Klaar als") and how to test it. */
export interface ControleKaartInfo {
  id: string;
  title: string;
  klaarAls: string[];
  testPlan?: { wat?: string; stappen?: string[]; letop?: string[]; pad?: string } | null;
}

/**
 * One thing to review, as the testlab's /api/external/controle/wijzigingen
 * gives it: a roadmap card (kaartId: approving it approves the card, even
 * with no screenshot at all), or a loose change = one commit (titel = its
 * subject), however many screenshots show it.
 */
export interface ControleWijziging {
  /** Set when this is a whole roadmap card: the decision also moves the card. */
  kaartId?: string;
  beeldIds: string[];
  project: string;
  commit: string;
  titel: string;
  schermen: string[];
  soort: string;
  onverwacht: boolean;
  anders: string | null;
  kaart: ControleKaartInfo | null;
  voorUrl: string | null;
  /** null: a card with no visual change. */
  naUrl: string | null;
  kader: ControleKader | null;
  /** Every screenshot of this change, the example first (older jabeja-admin: absent). */
  beelden?: ControleBeeld[];
}

/** The screenshots to page through: the list, or the one example; none for a card with no visual change. */
export function beeldenVan(w: ControleWijziging): ControleBeeld[] {
  if (w.beelden?.length) return w.beelden;
  return w.naUrl ? [{ plek: w.titel, scherm: w.schermen[0] ?? "", soort: w.soort, voorUrl: w.voorUrl, naUrl: w.naUrl, kader: w.kader }] : [];
}

export interface ControleLijst {
  klant: string;
  link: string;
  /** What the last run checked (testlab e2e/dekking.mjs), and any drop versus the run before. */
  dekking?: { samenvatting: string; minder: string[]; aangekondigd: string | null; link: string } | null;
  wijzigingen: ControleWijziging[];
}
