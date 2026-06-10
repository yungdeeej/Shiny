/** Noir name generator for freshly minted characters — deterministic from a seed. */
import { makeRng } from "@trash-wars/economy";

const FIRST = [
  "Knuckles",
  "Velvet",
  "Two-Step",
  "Patches",
  "Smokes",
  "Whiskers",
  "Greasy",
  "Lucky",
  "Half-Ear",
  "Midnight",
  "Slick",
  "Mumbles",
  "Tin-Can",
  "Dusty",
  "Fingers",
  "Pockets",
  "Shadow",
  "Rusty",
  "Gutter",
  "Moxie",
] as const;

const LAST = [
  "Malone",
  "the Lid",
  "O'Bin",
  "Deluxe",
  "from the Docks",
  "Charbonneau",
  "the Quiet",
  "McGraw",
  "Sterling",
  "the Snitch",
  "Vandella",
  "Knockover",
  "Birdie",
  "Le Chien",
  "Grimaldi",
  "the Squeak",
  "Hollows",
  "Drainpipe",
  "Fontaine",
  "Two-Times",
] as const;

export function generateCharacterName(seed: string): string {
  const rng = makeRng(`name:${seed}`);
  const first = FIRST[Math.floor(rng() * FIRST.length)] ?? "Knuckles";
  const last = LAST[Math.floor(rng() * LAST.length)] ?? "Malone";
  return `${first} ${last}`;
}
