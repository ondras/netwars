/**
 * How far a pilot perceives in a deathmatch (m), people and bots alike. All are less than half the smallest arena: that far away
 * a ship's nearest copy changes sides, so no sense ever takes in more than one copy of anything.
 * The radar reaches past sight, so it finds what the eyes cannot yet see; whatever can be heard is on the radar.
 */
export const SIGHT_REACH = 150;
export const RADAR_REACH = 180;
export const HEARING_REACH = RADAR_REACH;

/** Over how far before its reach a sense loses a thing (m) */
export const SENSE_FADE = 20;

/** How much of a thing this far away (m) a sense with this reach takes in, 0..1 */
export const senseFade = (distance: number, reach: number): number => Math.max(0, Math.min(1, (reach - distance) / SENSE_FADE));
