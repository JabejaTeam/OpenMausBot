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

/**
 * One change to review, as jabeja-admin's /api/external/controle/wijzigingen
 * gives it: one commit (titel = its subject), however many screenshots show it.
 */
export interface ControleWijziging {
  beeldIds: string[];
  project: string;
  commit: string;
  titel: string;
  schermen: string[];
  soort: string;
  onverwacht: boolean;
  anders: string | null;
  kaart: { id: string; title: string; klaarAls: string[] } | null;
  voorUrl: string | null;
  naUrl: string;
  kader: ControleKader | null;
  /** Every screenshot of this change, the example first (older jabeja-admin: absent). */
  beelden?: ControleBeeld[];
}

/** The screenshots to page through: the list, or the one example. */
export function beeldenVan(w: ControleWijziging): ControleBeeld[] {
  return w.beelden?.length ? w.beelden : [{ plek: w.titel, scherm: w.schermen[0] ?? "", soort: w.soort, voorUrl: w.voorUrl, naUrl: w.naUrl, kader: w.kader }];
}

export interface ControleLijst {
  klant: string;
  link: string;
  wijzigingen: ControleWijziging[];
}
