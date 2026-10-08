// The bloub look in three rows of still swatches (shape, expression, colour):
// the full avatar card and the simple settings panel share it.
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  BLOUB_COLOR_IDS,
  BLOUB_EXPRESSION_IDS,
  BLOUB_SHAPE_IDS,
  type BloubLook,
} from "../../shared/bloub-look";
import { BloubAvatar } from "./BloubAvatar";

/** A frozen bloub swatch (no animation loop per tile), like bloub's BotTile. */
function BloubSwatch({
  look,
  selected,
  label,
  disabled,
  onPick,
}: {
  look: BloubLook;
  selected: boolean;
  label: string;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onPick}
      className={cn(
        "flex h-[52px] items-center justify-center rounded-xl bg-inset transition-colors hover:bg-control disabled:opacity-50",
        selected && "ring-2 ring-accent-border",
      )}
    >
      <BloubAvatar size={40} shape={look.shape} expression={look.expression} color={look.color} />
    </button>
  );
}

const pickerHeading = "mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary";

export function BloubLookPicker({ look, disabled, onPick }: { look: BloubLook; disabled: boolean; onPick: (look: BloubLook) => void }) {
  return (
    <>
      <div className={pickerHeading}>{t("bloub.shapeLabel")}</div>
      <div className="grid grid-cols-4 gap-2">
        {BLOUB_SHAPE_IDS.map((id) => (
          <BloubSwatch
            key={id}
            look={{ ...look, shape: id }}
            selected={look.shape === id}
            label={t("bloub.useShape", { name: t(`bloub.shapes.${id}`) })}
            disabled={disabled}
            onPick={() => onPick({ ...look, shape: id })}
          />
        ))}
      </div>

      <div className={pickerHeading}>{t("bloub.expressionLabel")}</div>
      <div className="grid grid-cols-4 gap-2">
        {BLOUB_EXPRESSION_IDS.map((id) => (
          <BloubSwatch
            key={id}
            look={{ ...look, expression: id }}
            selected={look.expression === id}
            label={t("bloub.useExpression", { name: t(`bloub.expressions.${id}`) })}
            disabled={disabled}
            onPick={() => onPick({ ...look, expression: id })}
          />
        ))}
      </div>

      <div className={pickerHeading}>{t("bloub.colorLabel")}</div>
      <div className="grid grid-cols-6 gap-2">
        {BLOUB_COLOR_IDS.map((id) => (
          <BloubSwatch
            key={id}
            look={{ ...look, color: id }}
            selected={look.color === id}
            label={t("bloub.useColor", { name: t(`bloub.colors.${id}`) })}
            disabled={disabled}
            onPick={() => onPick({ ...look, color: id })}
          />
        ))}
      </div>
    </>
  );
}
