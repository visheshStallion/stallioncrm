import type { Tone } from "./primitives";

/** Status → pill tone mappings shared by server pages and client views. */
/** By stage type (OPEN / WON / LOST). */
export const stageTone = (stageType: string): Tone => (stageType === "WON" ? "success" : stageType === "LOST" ? "danger" : "primary");

export const statusTone = (s: string): Tone =>
  s === "CONVERTED" ? "success" : s === "UNQUALIFIED" ? "danger" : s === "QUALIFIED" ? "primary" : s === "CONTACTED" ? "info" : "neutral";

export const ratingTone = (r: string | null): Tone => (r === "HOT" ? "danger" : r === "WARM" ? "warning" : "info");
