import type { Tone } from "./primitives";

/** Status → pill tone mappings shared by server pages and client views. */
export const stageTone = (stage: string): Tone =>
  stage === "CLOSED_WON" ? "success" : stage === "CLOSED_LOST" ? "danger" : stage === "ENQUIRY" ? "neutral" : "primary";

export const statusTone = (s: string): Tone =>
  s === "CONVERTED" ? "success" : s === "UNQUALIFIED" ? "danger" : s === "QUALIFIED" ? "primary" : s === "CONTACTED" ? "info" : "neutral";

export const ratingTone = (r: string | null): Tone => (r === "HOT" ? "danger" : r === "WARM" ? "warning" : "info");
