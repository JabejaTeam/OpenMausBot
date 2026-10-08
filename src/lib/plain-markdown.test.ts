import { describe, expect, it } from "vitest";
import { plainMarkdown } from "./plain-markdown";

describe("plainMarkdown", () => {
  it("drops emphasis, code and link marks but keeps the words", () => {
    expect(plainMarkdown("Staat **live op [Jabeja Admin](https://x.be)**")).toBe("Staat live op Jabeja Admin");
    expect(plainMarkdown("Alles staat op `origin/main` en is *klaar*")).toBe("Alles staat op origin/main en is klaar");
    expect(plainMarkdown("Project **Ripal → Chauffeur app** is ~~oud~~ nieuw")).toBe("Project Ripal → Chauffeur app is oud nieuw");
  });

  it("drops line markers and a bold mark cut off by the preview", () => {
    expect(plainMarkdown("## Stand\n- een\n1. twee\n> citaat")).toBe("Stand\neen\ntwee\ncitaat");
    expect(plainMarkdown("**Intake 8 oktober: Gmail gecontroleerd")).toBe("Intake 8 oktober: Gmail gecontroleerd");
  });

  it("leaves snake_case, multiplication and lone stars alone", () => {
    expect(plainMarkdown("zet ripal_dev op 3 * 4")).toBe("zet ripal_dev op 3 * 4");
  });
});
