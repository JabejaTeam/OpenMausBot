// Office view (fork): the surfaces that float over the live 3D canvas — the
// toolbar, the status rail, team names, the hover chip, popovers. None of them
// uses backdrop-filter: a blur over a canvas that changes every frame is
// recomputed every frame and keeps Chromium from handing the canvas to the
// macOS compositor as its own layer (measured: about double the GPU process'
// cost while the office moves). Nearly opaque instead, so the blur is not
// missed. office-surface.test.ts keeps backdrop-filter out of the office.
export const OVER_CANVAS = {
  /** toolbar, status rail, hover chip */
  glass: "bg-panel/95 shadow-lg shadow-black/20",
  /** a team's name over its door */
  pill: "bg-panel/95 shadow-md shadow-black/20",
  /** search results, the look editor, the rail's list */
  popover: "bg-panel/95 shadow-xl shadow-black/30",
} as const;
