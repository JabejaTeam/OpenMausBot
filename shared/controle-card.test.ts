// Fork: a change from jabeja-admin pages through its screenshots; an older
// jabeja-admin without the list still shows its one example.
import { expect, it } from "vitest";
import { beeldenVan, type ControleWijziging } from "./controle-card.ts";

const wijziging: ControleWijziging = {
  beeldIds: ["a", "b"], project: "adops", commit: "f04874c", titel: "Zoekbalk bovenaan het platform", schermen: ["desktop", "mobiel"],
  soort: "gewijzigd", onverwacht: false, anders: null, kaart: null, voorUrl: "https://cdn/voor", naUrl: "https://cdn/na", kader: null,
};

it("pages through every screenshot of a change, or shows the one example", () => {
  const beelden = [
    { plek: "start", scherm: "desktop", soort: "gewijzigd", voorUrl: "https://cdn/voor", naUrl: "https://cdn/na", kader: null },
    { plek: "platen → lijst", scherm: "mobiel", soort: "gewijzigd", voorUrl: null, naUrl: "https://cdn/na2", kader: null },
  ];
  expect(beeldenVan({ ...wijziging, beelden })).toEqual(beelden);
  expect(beeldenVan(wijziging)).toEqual([{ plek: "Zoekbalk bovenaan het platform", scherm: "desktop", soort: "gewijzigd", voorUrl: "https://cdn/voor", naUrl: "https://cdn/na", kader: null }]);
});

it("has no screenshots for a roadmap card with no visual change", () => {
  expect(beeldenVan({ ...wijziging, kaartId: "k", beeldIds: [], naUrl: null, voorUrl: null, beelden: [] })).toEqual([]);
});
