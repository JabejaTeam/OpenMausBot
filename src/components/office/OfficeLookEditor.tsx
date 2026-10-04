// Office view (fork): a team's look — wall colour, and a logo or else its
// name on the wall in a text colour — edited from its
// name over the office door. Saved on the server for the whole workspace
// (server/team-looks.ts); only an admin may change it.
import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Trash2 } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { TEAM_TEXT_SWATCHES, TEAM_WALL_SWATCHES, type TeamLook } from "@/lib/office-team-looks";

type LookPatch = { color?: string | null; logo?: string | null; textColor?: string | null };

/** Every team's look, read once and kept current after each save. */
export function useTeamLooks() {
  const [looks, setLooks] = useState<Record<string, TeamLook>>({});
  useEffect(() => {
    api<{ teams: Record<string, TeamLook> }>("/api/team-looks").then((r) => setLooks(r?.teams ?? {})).catch(() => {});
  }, []);
  const save = async (teamId: string, patch: LookPatch) => {
    const r = await api<{ teams: Record<string, TeamLook> }>(`/api/team-looks/${encodeURIComponent(teamId)}`, { method: "PUT", body: JSON.stringify(patch) });
    if (r?.teams) setLooks(r.teams);
  };
  return { looks, save };
}

/** Any image the person picks, as a PNG of at most 512 px: never markup. */
async function logoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("unreadable image"));
      img.src = url;
    });
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth || 512, image.naturalHeight || 512));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 512) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 512) * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function OfficeLookEditor({
  teamId,
  label,
  look,
  onSave,
  onClose,
}: {
  teamId: string;
  label: string;
  look: TeamLook | undefined;
  onSave: (teamId: string, patch: LookPatch) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onDown = (event: PointerEvent) => !rootRef.current?.contains(event.target as Node) && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const run = async (patch: LookPatch) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(teamId, patch);
    } catch (e) {
      setError(e instanceof Error && /403|admin/i.test(e.message) ? t("office.look.adminOnly") : t("office.look.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t("office.look.title", { name: label })}
      className="w-72 rounded-2xl border border-hairline/40 bg-panel/90 p-3 shadow-xl shadow-black/30 backdrop-blur-xl"
    >
      <div className="px-1 pb-2 text-[13px] font-semibold text-ink">{label}</div>
      <div className="px-1 pb-1.5 text-[12px] text-ink-secondary">{t("office.look.wall")}</div>
      <Swatches colors={TEAM_WALL_SWATCHES} value={look?.color} fallback="#d9dde3" busy={busy} onPick={(color) => run({ color })} />
      <div className="mt-3 px-1 pb-1.5 text-[12px] text-ink-secondary">{t("office.look.logo")}</div>
      <div className="flex items-center gap-2 px-1">
        {look?.logo && <img src={look.logo} alt="" className="size-10 rounded-lg bg-white object-contain p-1 ring-1 ring-black/10" />}
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex h-8 items-center gap-1.5 rounded-full bg-raised/60 px-3 text-[13px] text-ink hover:bg-raised"
        >
          <ImagePlus size={14} />
          {look?.logo ? t("office.look.replace") : t("office.look.upload")}
        </button>
        {look?.logo && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run({ logo: null })}
            title={t("office.look.remove")}
            aria-label={t("office.look.remove")}
            className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Trash2 size={14} />
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              await run({ logo: await logoDataUrl(file) });
            } catch {
              setError(t("office.look.failed"));
            }
          }}
        />
      </div>
      {/* no logo: the name is on the wall, in a colour you pick; a logo has its own */}
      {!look?.logo && (
        <>
          <div className="mt-3 px-1 pb-1.5 text-[12px] text-ink-secondary">{t("office.look.text")}</div>
          <Swatches colors={TEAM_TEXT_SWATCHES} value={look?.textColor} fallback="#1d1d1f" busy={busy} onPick={(textColor) => run({ textColor })} />
        </>
      )}
      {error && <div className="mt-2 px-1 text-[12px] text-danger">{error}</div>}
    </div>
  );
}

/** A row of colours; the chosen one again clears it (back to the default). */
function Swatches({ colors, value, fallback, busy, onPick }: { colors: string[]; value: string | undefined; fallback: string; busy: boolean; onPick: (color: string | null) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1.5 px-1">
      {colors.map((color) => {
        const chosen = value === color;
        return (
          <button
            key={color}
            type="button"
            disabled={busy}
            onClick={() => onPick(chosen ? null : color)}
            aria-label={color}
            aria-pressed={chosen}
            style={{ background: color }}
            className={cn("flex size-7 items-center justify-center rounded-full ring-1 ring-black/10 transition-transform hover:scale-110", chosen && "ring-2 ring-accent")}
          >
            {chosen && <Check size={13} className="text-black/60 mix-blend-luminosity" />}
          </button>
        );
      })}
      <label title={t("office.look.custom")} className="relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10" style={{ background: "conic-gradient(#f43f5e,#f59e0b,#84cc16,#06b6d4,#6366f1,#d946ef,#f43f5e)" }}>
        <input
          type="color"
          value={value ?? fallback}
          disabled={busy}
          onChange={(event) => onPick(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={t("office.look.custom")}
        />
      </label>
    </div>
  );
}
