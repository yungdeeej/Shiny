/**
 * "The Shorefront Sentinel" voice — 1940s noir crime-beat reporter covering
 * raccoon crime in a neon city.
 *
 * Beta scope: template-based generation is the default (no Anthropic key in
 * beta). When ANTHROPIC_API_KEY is set, drafts are written by Claude via a
 * plain-fetch Messages API call instead, with templates as the fallback.
 *
 * v1.1: every draft now carries headline + story + a pull-quote (the byline
 * detail the front page hangs on) + an image prompt. 8 headlines per event
 * type, two new event types (mint, faction-war).
 */
import type { StoryEvent, StoryKind } from "./consume.js";

export interface DraftPost {
  headline: string;
  story: string;
  /** A one-line attributed quote — the noir flourish that sells the front page. */
  pullQuote: string;
  imagePrompt: string;
  generator: "template" | "claude";
}

const IMAGE_STYLE_SUFFIX =
  "— 1940s noir editorial illustration, neon rain, film grain, dramatic chiaroscuro, anthropomorphic animals, Shorefront City skyline, deep navy and charcoal with amber accents";

/* ── templates (~8 headlines per event type) ───────────────────────────── */

// {actor} {location} {x} {amount} are substituted; absent values get noir-safe fallbacks.
const HEADLINES: Record<StoryKind, string[]> = {
  jackpot: [
    "MASKED RACCOON ESCAPES {location} WITH {x}× HAUL; PD HUMILIATED",
    "{x}× SCORE AT {location} — WITNESSES SAW ONLY A STRIPED TAIL",
    "NIGHT OF SHAME FOR THE BLOODHOUNDS: {actor} WALKS WITH {x}× THE STAKE",
    "ALARM BELLS, EMPTY VAULT: {location} HIT FOR A {x}× JACKPOT",
    "'IT WAS GONE BEFORE THE LIGHTS CAME ON' — {x}× HEIST STUNS {location}",
    "CITY ASKS: WHO IS {actor}? {x}× JACKPOT LEAVES PD CHASING SHADOWS",
    "THE HOUSE BLINKED: {actor} TAKES {x}× OUT OF {location}",
    "{x}× AND CLEAN AWAY — {location} JOINS THE WALL OF SHAME",
  ],
  death: [
    "OBITUARY FROM THE GUTTER: {actor} WON'T BE COMING HOME",
    "ONE MORE NAME ON THE WALL — {actor} REKT AT {location}",
    "THE RAIN FALLS HARDER TONIGHT: {actor}, GONE AT {location}",
    "NO BAIL, NO BODY, NO LUCK — {actor}'S LAST JOB",
    "FLOWERS BY THE DUMPSTER: SHOREFRONT MOURNS {actor}",
    "THE HOUSE ALWAYS COLLECTS: {actor} PAYS THE FINAL PRICE",
    "LIGHTS OUT AT {location}: {actor} ROLLED ONE TIME TOO MANY",
    "THEY BURNED THE PAPERWORK AND THE BODY — SO LONG, {actor}",
  ],
  confiscation: [
    "PD SHAKEDOWN AT {location}: {amount} $SHINY SEIZED IN ONE NIGHT",
    "THE HOUNDS EAT WELL TONIGHT — MASSIVE CONFISCATION AT {location}",
    "EVIDENCE LOCKER OVERFLOWS: {amount} $SHINY OFF THE STREET",
    "BAD NIGHT TO BE GREEDY: {location} RAID NETS {amount} $SHINY",
    "BLOODHOUNDS BITE BACK — RECORD SEIZURE STUNS {location} REGULARS",
    "'NOTHING PERSONAL,' SAYS SERGEANT, COUNTING {amount} $SHINY",
    "POCKETS EMPTIED AT {location}: {amount} $SHINY INTO THE PD POOL",
    "THE BADGE GETS PAID — {amount} $SHINY CONFISCATED AT {location}",
  ],
  raffle: [
    "TICKETS BURNED, FORTUNES TURNED: RECRUITMENT RAFFLE NAMES ITS WINNERS",
    "LADY LUCK PICKS A POCKET — RAFFLE RESULTS ARE IN",
    "FROM ASH TO RICHES: RAFFLE DRAW LIGHTS UP THE SHOREFRONT",
    "ONE TICKET, ONE LEGEND: RAFFLE WINNERS ANNOUNCED AT MIDNIGHT",
    "THE DRUM SPUN, THE CITY HELD ITS BREATH — RAFFLE RESULTS INSIDE",
    "BURNED TICKETS, NEW BLOOD: THE RAFFLE DELIVERS",
    "MIDNIGHT DRAW MINTS A NOBODY INTO A SOMEBODY",
    "SMOKE CLEARED, NAMES CALLED — RAFFLE NIGHT ON THE SHOREFRONT",
  ],
  burn: [
    "UP IN SMOKE, ON THE RECORD: WEEKLY $SHINY BURN COMPLETE",
    "THE FURNACE NEVER LIES — THIS WEEK'S BURN HITS THE LEDGER",
    "SUPPLY GETS A HAIRCUT: WEEKLY BURN EXECUTED ON-CHAIN",
    "ANOTHER SUNDAY, ANOTHER PYRE: $SHINY BURN CONFIRMED",
    "RECEIPTS OR IT DIDN'T HAPPEN — BURN TX LANDS, NUMBERS ATTACHED",
    "THE CITY BURNS ITS OWN MONEY, AND THE CITY CHEERS",
    "{amount} $SHINY MEETS THE FURNACE — TX ON THE WIRE",
    "THINNER SUPPLY, FATTER LEGEND: THE WEEKLY BURN IS DONE",
  ],
  mint: [
    "FRESH BLOOD HITS THE STREET: A NEW MINT WAVE OPENS AT THE MINT",
    "BURN TO BE BORN — RECRUITS POUR OUT OF THE MINT TONIGHT",
    "THE MINT REOPENS ITS DOORS; THE LINE WRAPS THE BLOCK",
    "NEW MASKS, NEW MARKS: MINT WAVE LIGHTS UP THE SHOREFRONT",
    "SCARCITY IS THE PITCH — ANOTHER MINT WAVE, ANOTHER FRENZY",
    "THEY BURNED $SHINY FOR A FACE AND A FUTURE: MINT WAVE LIVE",
    "THE FURNACE GIVETH: NEW CHARACTERS MINTED OUT OF SMOKE",
    "WANT A RAP SHEET? THE MINT IS TAKING NAMES TONIGHT",
  ],
  "faction-war": [
    "BLUE LINE ON THE MOVE: BLOODHOUNDS FLOOD {location}",
    "TURF GOES HOT AT {location} — PATROLS THICK AS RAIN",
    "THE HOUNDS DRAW A LINE AT {location}; THE RACCOONS DRAW STRAWS",
    "STREET WAR FLARES: {location} CRAWLING WITH BADGES TONIGHT",
    "HEAT INDEX MAXED AT {location} — PICK YOUR NIGHT CAREFULLY",
    "EVERY ALLEY WATCHED: {location} UNDER A BLOODHOUND SIEGE",
    "THE PD PLANTS ITS FLAG AT {location}; ODDS GO UGLY",
    "WAR DRUMS ON THE SHOREFRONT — {location} IS A PD KILL-BOX TONIGHT",
  ],
};

const STORIES: Record<StoryKind, string> = {
  jackpot:
    "Sources at {location} describe a job so clean the cameras blinked and missed it. {actor} slipped past every patrol on the block and walked into the rain {x} times richer. Down at the precinct, the Bloodhounds are calling it luck. The street is calling it legend.",
  death:
    "They found what was left near {location} just after the neon came on. {actor} played the long odds one time too many, and Shorefront City doesn't do refunds. Pour one out — then check your insurance.",
  confiscation:
    "The PD swept {location} like a landlord on rent day, and the evidence locker is heavier for it. Every coin seized feeds the hounds' pool — the cops eat what you lose. Word to the wise: heat like this doesn't cool fast.",
  raffle:
    "Down at the tip line they're saying the drum spun true. Tickets went into the fire, names came out, and somewhere in this city a nobody just became a somebody. That's Shorefront — the house burns the entry fee either way.",
  burn:
    "Like clockwork, the city marched another pile of {amount} $SHINY into the furnace — every coin accounted for, tx sig on the wire. The supply gets thinner, the story gets better. Receipts attached, as always.",
  mint:
    "The Mint cracked its doors tonight and the line ran clear past the bodega. Hopefuls burned good $SHINY to step out the other side with a new face, a fresh rap sheet, and a target on their back. Scarcity, the proprietors remind us, is the whole point.",
  "faction-war":
    "Word from the corners is the Bloodhounds rolled deep on {location} tonight — badges in every doorway, spotlights on every fire escape. The odds went ugly fast. Run it if you're feeling lucky; the rest of us will read about you tomorrow.",
};

const PULL_QUOTES: Record<StoryKind, string[]> = {
  jackpot: [
    "\"We had it locked six ways. They left through the seventh.\" — a Bloodhound sergeant, off the record",
    "\"That tail? Last thing the cameras ever saw.\" — a witness at {location}",
  ],
  death: [
    "\"Everybody's lucky 'til they're a chalk line.\" — the coroner at {location}",
    "\"They never listen about the insurance.\" — a pawnbroker who knew {actor}",
  ],
  confiscation: [
    "\"Nothing personal. Just the badge collecting its tab.\" — Sergeant, {location}",
    "\"The cops eat what you lose, friend. Tonight they're stuffed.\" — a regular",
  ],
  raffle: [
    "\"One ticket. That's the whole religion.\" — a raffle winner, beaming",
    "\"The fire took the rest. The fire always does.\" — the drum operator",
  ],
  burn: [
    "\"You can't fake a furnace. The numbers are the numbers.\" — the ledger keeper",
    "\"Burn it down, watch it climb.\" — a holder, unbothered",
  ],
  mint: [
    "\"Burned my last coins for this face. Worth every spark.\" — a fresh recruit",
    "\"They only open the doors when the doors mean something.\" — a Mint regular",
  ],
  "faction-war": [
    "\"You can smell the blue from two blocks off.\" — a lookout at {location}",
    "\"Pick another night. {location}'s a trap tonight.\" — a retired crew boss",
  ],
};

const IMAGE_PROMPTS: Record<StoryKind, string> = {
  jackpot: "A masked raccoon mid-leap over a casino vault door, banknotes spiraling in neon rain {style}",
  death: "A lone fedora floating in a rain-soaked gutter under flickering neon, mourners' silhouettes {style}",
  confiscation: "Stern bloodhound officers carting crates of glowing coins out of a smoky back-alley club {style}",
  raffle: "A brass raffle drum spilling burning tickets, a crowd of animals under umbrellas watching {style}",
  burn: "An industrial furnace door glowing orange, a mountain of coins shoveled in by silhouetted figures {style}",
  mint: "A monumental art-deco tower, THE MINT, doors flung open with new masked raccoons spilling into neon rain {style}",
  "faction-war":
    "A rain-slick avenue lit blue by police spotlights, trench-coated bloodhounds blockading every alley while a raccoon watches from a rooftop {style}",
};

function fill(tpl: string, evt: StoryEvent): string {
  return tpl
    .replaceAll("{actor}", evt.actor ?? "an unnamed operator")
    .replaceAll("{location}", prettyLocation(evt.locationSlug))
    .replaceAll("{x}", evt.multiplierX !== undefined ? String(evt.multiplierX) : "many")
    .replaceAll(
      "{amount}",
      evt.amount !== undefined ? evt.amount.toLocaleString("en-US") : (evt.amountBand ?? "a fortune in"),
    );
}

function prettyLocation(slug?: string): string {
  if (!slug) return "an undisclosed corner of the city";
  return slug.split(/[-_]/).map((w) => w.toUpperCase()).join(" ");
}

function pick<T>(arr: T[], seed: string): T {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return arr[Math.abs(h) % arr.length]!;
}

export function templateDraft(evt: StoryEvent): DraftPost {
  return {
    headline: fill(pick(HEADLINES[evt.kind], evt.sourceId), evt),
    story: fill(STORIES[evt.kind], evt),
    pullQuote: fill(pick(PULL_QUOTES[evt.kind], evt.sourceId + "q"), evt),
    imagePrompt: IMAGE_PROMPTS[evt.kind].replace("{style}", IMAGE_STYLE_SUFFIX),
    generator: "template",
  };
}

/* ── optional Claude path (plain fetch — no SDK dep in beta) ───────── */

const SYSTEM_PROMPT = `You are the sole crime-beat reporter for THE SHOREFRONT SENTINEL, the in-world newspaper of Shorefront City — a perpetual-rain neon metropolis where raccoon crews knock over banks and Bloodhound PD eats what they confiscate. Voice: 1940s noir, punchy, wry, never cruel to real people; the city itself is a character. You write about game events for the $SHINY economy game Trash Wars.

For each event you receive (JSON), respond with ONLY a JSON object:
{"headline": "<ALL-CAPS tweet-length headline>", "story": "<2-3 sentence noir story>", "pullQuote": "<one short attributed quote, e.g. \\"...\\" — a witness>", "imagePrompt": "<one-line illustration prompt>"}

Few-shot examples of the voice:

Event: jackpot, 12x, location "first-national", actor "TrashKing"
{"headline": "MASKED RACCOON ESCAPES FIRST NATIONAL WITH 12× HAUL; PD HUMILIATED", "story": "The vault was open four minutes. That's all TrashKing needed to turn one stake into twelve and vanish into the rain like a rumor. The Bloodhounds say they're 'pursuing leads.' The leads, sources confirm, are laughing.", "pullQuote": "\\"We had it locked six ways. He left through the seventh.\\" — a Bloodhound sergeant, off the record", "imagePrompt": "A grinning raccoon in a domino mask sliding down a fire escape clutching glowing sacks of coin"}

Event: death, actor "Dumpster_Dan", location "the-docks"
{"headline": "THE RAIN FALLS HARDER TONIGHT: DUMPSTER_DAN, GONE AT THE DOCKS", "story": "He always said the docks owed him one. Last night the docks collected instead. No bail, no body, no luck — just a fedora in the gutter and a tab nobody's going to pay.", "pullQuote": "\\"Everybody's lucky 'til they're a chalk line.\\" — the dockside coroner", "imagePrompt": "A lone fedora floating in a rain-soaked dockside gutter under a flickering crane light"}

Event: confiscation, 31,000 SHINY, location "neon-strip"
{"headline": "HOUNDS FEAST ON THE NEON STRIP — 31,000 $SHINY OFF THE STREET", "story": "The PD hit the Strip like rent day, and 31,000 $SHINY went from warm pockets to the evidence locker. The cops eat what you lose, friend. Tonight they're eating well.", "pullQuote": "\\"Nothing personal. Just the badge collecting its tab.\\" — Sergeant Boggs", "imagePrompt": "Bloodhound officers in trench coats carting crates of glowing coins past stunned nightclub patrons"}

Event: raffle results
{"headline": "TICKETS BURNED, FORTUNES TURNED: RAFFLE NAMES ITS WINNERS", "story": "The drum spun at midnight and the fire took the rest. Somewhere in this city a nobody is suddenly a somebody with a new recruit and a target on their back. That's Shorefront for you.", "pullQuote": "\\"One ticket. That's the whole religion.\\" — a beaming winner", "imagePrompt": "A brass raffle drum spilling burning tickets before a crowd of animals under black umbrellas"}

Event: weekly burn, 14.2M SHINY
{"headline": "UP IN SMOKE, ON THE RECORD: 14.2M $SHINY MEETS THE FURNACE", "story": "Like clockwork, the city marched 14.2 million $SHINY into the fire — every coin receipted, tx sig on the wire. The supply gets thinner. The legend gets fatter.", "pullQuote": "\\"You can't fake a furnace. The numbers are the numbers.\\" — the ledger keeper", "imagePrompt": "An industrial furnace door glowing orange as silhouetted figures shovel in mountains of coins"}

Event: mint, location "the-mint"
{"headline": "BURN TO BE BORN — RECRUITS POUR OUT OF THE MINT TONIGHT", "story": "The Mint cracked its doors and the line ran past the bodega before the rain even started. They burned good $SHINY to walk out with a new face and a fresh rap sheet. Scarcity, the proprietors remind us, is the whole point.", "pullQuote": "\\"Burned my last coins for this face. Worth every spark.\\" — a fresh recruit", "imagePrompt": "A monumental art-deco tower with doors flung open, new masked raccoons spilling into neon rain"}

Event: faction-war / heavy patrol, location "jewelry-district"
{"headline": "BLUE LINE ON THE MOVE: BLOODHOUNDS FLOOD THE JEWELRY DISTRICT", "story": "The hounds rolled deep on the Jewelry District tonight — badges in every doorway, spotlights up every fire escape. The odds went ugly fast. Run it if you're feeling lucky; the rest of us will read about you tomorrow.", "pullQuote": "\\"You can smell the blue from two blocks off.\\" — a rooftop lookout", "imagePrompt": "A rain-slick avenue lit blue by police spotlights, trench-coated bloodhounds blockading every alley"}`;

async function claudeDraft(evt: StoryEvent): Promise<DraftPost> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Event: ${JSON.stringify(evt)}` }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { headline: string; story: string; pullQuote?: string; imagePrompt: string };
  return {
    headline: parsed.headline,
    story: parsed.story,
    pullQuote: parsed.pullQuote ?? fill(pick(PULL_QUOTES[evt.kind], evt.sourceId + "q"), evt),
    imagePrompt: `${parsed.imagePrompt} ${IMAGE_STYLE_SUFFIX}`,
    generator: "claude",
  };
}

/** Draft a post: Claude when a key is configured, templates otherwise (and on error). */
export async function draftPost(evt: StoryEvent): Promise<DraftPost> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await claudeDraft(evt);
    } catch (err) {
      console.warn(`voice: claude draft failed, falling back to template: ${String(err)}`);
    }
  }
  return templateDraft(evt);
}
