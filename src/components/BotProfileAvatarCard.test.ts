import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StoreProvider, type Bot } from "@/state/store";
import { BLOUB_COLOR_IDS, BLOUB_EXPRESSION_IDS, BLOUB_SHAPE_IDS } from "../../shared/bloub-look";
import en from "@/locales/en.json";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    threadId: "thread-1",
    name: "Maus",
    title: "Maus",
    description: "",
    notifications: false,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "local", model: "test-model" },
    messages: [],
    ...overrides,
  };
}

function renderCard(bot: Bot) {
  return renderToStaticMarkup(
    createElement(
      StoreProvider,
      null,
      createElement(BotProfileAvatarCard, {
        bot,
        activeState: "idle",
        mascotMotion: null,
        onPatch: vi.fn(),
      }),
    ),
  );
}

describe("BotProfileAvatarCard bloub pickers", () => {
  it("renders one still swatch per bloub shape, expression and colour, labeled by name", () => {
    const markup = renderCard(makeBot());

    expect(markup).toContain(">Shape<");
    expect(markup).toContain(">Expression<");
    expect(markup).toContain(">Colour<");
    for (const id of BLOUB_SHAPE_IDS) expect(markup).toContain(`aria-label="Use the ${en[`bloub.shapes.${id}`]} shape"`);
    for (const id of BLOUB_EXPRESSION_IDS) expect(markup).toContain(`aria-label="Use the ${en[`bloub.expressions.${id}`]} expression"`);
    for (const id of BLOUB_COLOR_IDS) expect(markup).toContain(`aria-label="Use the ${en[`bloub.colors.${id}`]} colour"`);
  });

  it("marks the default look pressed: circle, neutral, the bot colour's nearest", () => {
    const markup = renderCard(makeBot({ color: "purple" }));

    expect(markup).toContain('aria-pressed="true" aria-label="Use the Circle shape"');
    expect(markup).toContain('aria-pressed="true" aria-label="Use the Neutral expression"');
    expect(markup).toContain('aria-pressed="true" aria-label="Use the Violet colour"');
    expect(markup).toContain('aria-pressed="false" aria-label="Use the Cloud shape"');
  });

  it("reflects an explicitly chosen look", () => {
    const markup = renderCard(makeBot({ bloub: { shape: "nuage", expression: "fier", color: "ambre" } }));

    expect(markup).toContain('aria-pressed="true" aria-label="Use the Cloud shape"');
    expect(markup).toContain('aria-pressed="true" aria-label="Use the Proud expression"');
    expect(markup).toContain('aria-pressed="true" aria-label="Use the Amber colour"');
    expect(markup).toContain('aria-pressed="false" aria-label="Use the Circle shape"');
  });

  it("offers zoom and drag framing for a custom image", () => {
    const markup = renderCard(makeBot({
      avatarUrl: "/api/attachments/cat.webp",
      avatarCrop: "circle",
      avatarZoom: 1.5,
    }));
    expect(markup).toContain('aria-label="Zoom avatar"');
    expect(markup).toContain("Drag the picture to reposition it");
    expect(markup).toContain("150%");
    expect(markup).toContain("Reset framing");
  });

  it("hides zoom controls for the mascot", () => {
    const markup = renderCard(makeBot());
    expect(markup).not.toContain('aria-label="Zoom avatar"');
  });

  it("hides the bloub pickers for flat crops that have no mascot to wear one", () => {
    const markup = renderCard(makeBot({ avatarCrop: "circle" }));

    expect(markup).not.toContain(">Expression<");
    expect(markup).not.toContain('aria-label="Use the Circle shape"');
  });

  it("hides the bloub pickers for every flat crop, not just circle", () => {
    for (const crop of ["rounded", "square"] as const) {
      const markup = renderCard(makeBot({ avatarCrop: crop }));

      expect(markup).not.toContain(">Expression<");
    }
  });
});
