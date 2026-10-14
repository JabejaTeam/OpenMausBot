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

/** One change to review, as jabeja-admin's /api/external/controle/wijzigingen gives it. */
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
}

export interface ControleLijst {
  klant: string;
  link: string;
  wijzigingen: ControleWijziging[];
}
