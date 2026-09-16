/**
 * THE PIPELINE'S STORED-IDEAS GATE, the part that decides.
 *
 * The idea step is a choice over the organisation's STORED ideas, not over a
 * batch the run just made: "a list of the organisation's blog ideas no draft has
 * used — each one a piece of text, its first line the title — with a button to
 * generate new ones; picks exactly one; nothing is picked for them, and an empty
 * list ends the run with a plain reason."
 *
 * PURE — no database, no `server-only` — so every sentence above is decided in
 * one testable place and the runner beside it only carries the reads and writes.
 * What the runner cannot decide on its own lives here: which ideas are still on
 * offer, what an idea is called, whether a pick is one of the offered ones, and
 * what a person is told when their pick lost the race.
 *
 * THIS MODULE IS THE PACK'S OWN. The decision logic and the table it names belong
 * to the extension that ships them, not to the runtime that runs them: a fixed
 * step of this pack asks the host's ONE generic dispatch to run a tool this pack
 * DECLARES, the host resolves that name against this pack's own manifest and
 * loads the module from this pack's own tree, and it holds neither a pack's
 * business logic nor its physical table names.
 */

/** This package, as its manifest names it. The one place the name is written. */
export const PACKAGE_NAME = "@cinatra-ai/blog-pipeline-agent";

/**
 * The same table as this extension DECLARES it in its manifest — the
 * declaration-local name the extension-data tool takes, which the host prefixes
 * into the physical one below.
 */
export const IDEA_RELATION_TABLE_DECLARED = "idea_drafts";

/**
 * The normalisation the prefix rule applies to each segment of a scoped package
 * name: lowercase, then every character outside letters, digits and underscore
 * becomes an underscore.
 */
function normalizeNameSegment(segment: string): string {
  return segment.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/**
 * The physical name of a table this extension declares: `ext_`, then the scope
 * and the slug of its package name normalised, joined and terminated by
 * underscores, then the declared name.
 *
 * DERIVED, NEVER WRITTEN TWICE: the declared name above is the only place the
 * relation is named, so the pair cannot drift.
 */
/** The database's identifier limit a derived name must fit. */
const PG_IDENTIFIER_MAX_BYTES = 63;

export function declaredTablePhysicalName(declaredName: string): string {
  const match = /^@([^/]+)\/([^/]+)$/.exec(PACKAGE_NAME);
  if (!match || !match[1] || !match[2]) {
    throw new Error(
      `cannot derive a table prefix for package "${PACKAGE_NAME}" — ` +
        "extension-owned tables require a scoped package name",
    );
  }
  const prefix = `ext_${normalizeNameSegment(match[1])}_${normalizeNameSegment(match[2])}_`;
  const physical = `${prefix}${declaredName}`;
  // The database's own identifier limit, checked here rather than discovered at
  // install: a declaration whose derived name does not fit is refused before the
  // table it names can be created under a silently truncated one.
  const bytes = new TextEncoder().encode(physical).length;
  if (bytes > PG_IDENTIFIER_MAX_BYTES) {
    throw new Error(
      `the table name "${physical}" derived for ${PACKAGE_NAME} is ${bytes} bytes, ` +
        `over the ${PG_IDENTIFIER_MAX_BYTES}-byte identifier limit`,
    );
  }
  return physical;
}

/** The pipeline's own relation table, under this extension's derived prefix. */
export const IDEA_RELATION_TABLE = declaredTablePhysicalName(IDEA_RELATION_TABLE_DECLARED);

/** A row of that table is live — it takes its idea off the list — until it is
 *  released. `reserved` is the pick; `drafted` is the completed relation. */
export const LIVE_RELATION_STATES = ["reserved", "drafted"] as const;
export const RELEASED_RELATION_STATE = "released";

/** An idea as it comes off the dependency-scoped listing plus its content read. */
export interface StoredIdeaCandidate {
  readonly artifactId: string;
  readonly representationRevisionId: string;
  readonly text: string;
}

/** An idea as the gate offers it: the same reference, plus the title its first
 *  line is. */
export interface OfferedIdea extends StoredIdeaCandidate {
  readonly title: string;
}

export type StoredIdeaOffer =
  | { readonly ok: true; readonly ideas: OfferedIdea[] }
  /** The run ends here, with this sentence — never with a pick nobody made. */
  | { readonly ok: false; readonly reason: string };

export type IdeaPickOutcome =
  | { readonly ok: true; readonly idea: OfferedIdea }
  | { readonly ok: false; readonly reason: string };

/** What a person is told when the idea they picked was taken between the list
 *  being drawn and their pick landing. */
export const IDEA_TAKEN_REASON =
  "That blog idea was just taken by another run. The list has been refreshed — pick another one.";

const EMPTY_LIST_REASON =
  "There is no blog idea left to draft: every stored idea already has a draft or is reserved by " +
  "another run. Generate new ideas, then start the pipeline again.";

/** A refusal this gate raises before anything is read or written. `reason` is the
 *  machine-readable class the passthrough reports it under. */
/** The name every refusal of this kind carries, on the error and in the guard. */
export const IDEA_TYPE_REFUSAL_NAME = "IdeaTypeRefusal";

export class IdeaTypeRefusal extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = IDEA_TYPE_REFUSAL_NAME;
    this.reason = reason;
  }
}

/**
 * The refusal recognised WITHOUT importing this class. The check that raises it
 * now lives on this side of the border, so the passthrough that reports it can no
 * longer name the class: it reads the shape instead — the name above and the
 * machine-readable `reason` — and reports the refusal as the refusal it has always
 * been rather than as a fault of the run.
 */
export function isIdeaTypeRefusal(
  error: unknown,
): error is { readonly name: string; readonly reason: string; readonly message: string } {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; reason?: unknown; message?: unknown };
  return (
    e.name === IDEA_TYPE_REFUSAL_NAME &&
    typeof e.reason === "string" &&
    e.reason.length > 0 &&
    typeof e.message === "string"
  );
}

/**
 * THE CALLING EXTENSION NAMES THE TYPE, NEVER THE HOST. The runtime may not
 * hard-code an extension instance, and it does not need to: the type an idea is
 * filed under is the caller's own declared dependency, so the flow node passes it
 * and the admission refuses anything the extension has not declared. A call that
 * names no type is refused rather than widened to every type the extension may
 * read — the offer would then be a list of posts and pictures.
 */
export function requireIdeaType(raw: Record<string, unknown>): string {
  const ideaType = typeof raw.ideaType === "string" ? raw.ideaType.trim() : "";
  if (ideaType.length === 0) {
    throw new IdeaTypeRefusal(
      "invalid-request",
      "stored_ideas: `ideaType` is required — the calling extension names the artifact type " +
        "its ideas are filed under, and it must be one of its own declared dependencies",
    );
  }
  return ideaType;
}

/**
 * The idea's title is the FIRST LINE of its text.
 *
 * The idea generator writes each idea as one piece of plain text whose first line
 * is the title, and writes that line as `Title: …`; a person who wrote the idea
 * themselves wrote a bare line. Both are the same title, so the prefix is read
 * off rather than shown.
 */
export function titleFromIdeaText(text: string): string {
  const firstLine = (text ?? "").split(/\r?\n/, 1)[0]?.trim() ?? "";
  const withoutPrefix = firstLine.replace(/^title\s*:\s*/i, "").trim();
  return withoutPrefix;
}

/**
 * The ideas still on offer: every candidate whose artifact no live relation row
 * names.
 *
 * A candidate with no readable text is still an idea — it is offered under an
 * empty title rather than dropped, because dropping it would silently shrink a
 * list a person is choosing from.
 */
export function offerStoredIdeas(input: {
  readonly candidates: readonly StoredIdeaCandidate[];
  readonly takenArtifactIds: readonly string[];
}): StoredIdeaOffer {
  const taken = new Set(input.takenArtifactIds);
  const ideas: OfferedIdea[] = [];
  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    if (taken.has(candidate.artifactId)) continue;
    if (seen.has(candidate.artifactId)) continue;
    seen.add(candidate.artifactId);
    ideas.push({ ...candidate, title: titleFromIdeaText(candidate.text) });
  }
  if (ideas.length === 0) return { ok: false, reason: EMPTY_LIST_REASON };
  return { ok: true, ideas };
}

/**
 * The offered list as the RUN carries it, read back into ideas.
 *
 * The flow's reservation step sends its offer as the template `{{ ideas | tojson }}`
 * and its pick as one InputMessageNode string, so BOTH sides of a reservation
 * arrive as JSON TEXT. The pick side has always been read back that way; this is
 * the same reading for the list it is validated against, so the two halves of one
 * call are parsed by one rule instead of the list silently arriving empty and
 * refusing every pick made against it.
 *
 * FAILS SOFT, unlike the pick: an unreadable list is an EMPTY list, and an element
 * that is not a usable reference is dropped rather than rejecting the whole offer.
 * Nothing is admitted by this — `resolveIdeaPick` still fails closed on an empty
 * list and still refuses a pick naming anything the list does not hold — so the
 * strict decision stays in exactly one place.
 */
export function parseOfferedIdeas(value: unknown): OfferedIdea[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return [];
    try {
      raw = JSON.parse(trimmed) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const ideas: OfferedIdea[] = [];
  for (const element of raw) {
    if (!element || typeof element !== "object" || Array.isArray(element)) continue;
    const e = element as {
      artifactId?: unknown;
      representationRevisionId?: unknown;
      title?: unknown;
      text?: unknown;
    };
    if (typeof e.artifactId !== "string" || e.artifactId.length === 0) continue;
    if (
      typeof e.representationRevisionId !== "string" ||
      e.representationRevisionId.length === 0
    ) {
      continue;
    }
    ideas.push({
      artifactId: e.artifactId,
      representationRevisionId: e.representationRevisionId,
      title: typeof e.title === "string" ? e.title : "",
      text: typeof e.text === "string" ? e.text : "",
    });
  }
  return ideas;
}

/**
 * The person's pick, validated against the list they were shown.
 *
 * FAILS CLOSED IN EVERY DIRECTION the silent first-idea default used to fill in:
 * nothing picked, an unparseable pick, a pick naming an artifact the list did not
 * offer, a pick naming a revision other than the offered one, and an offered list
 * that is missing altogether. The pick is recorded by artifact id AND revision —
 * never by title, which two ideas may share and which changes when an idea is
 * rewritten.
 */
export function resolveIdeaPick(input: {
  readonly pick: unknown;
  readonly offered: readonly OfferedIdea[];
}): IdeaPickOutcome {
  if (input.offered.length === 0) {
    return {
      ok: false,
      reason:
        "The idea gate has no offered list to validate a pick against, so no idea can be taken. " +
        "The run stops rather than drafting an idea nobody chose.",
    };
  }
  const parsed = parsePick(input.pick);
  if (!parsed) {
    return {
      ok: false,
      reason:
        "No blog idea was chosen at the idea gate. Pick exactly one idea from the list — nothing " +
        "is chosen for you.",
    };
  }
  const match = input.offered.find(
    (idea) =>
      idea.artifactId === parsed.artifactId &&
      idea.representationRevisionId === parsed.representationRevisionId,
  );
  if (!match) {
    return {
      ok: false,
      reason:
        `The chosen idea (${parsed.artifactId}) is not one of the ${input.offered.length} ideas the ` +
        "gate offered, or it has been rewritten since the list was drawn. Refresh the list and pick again.",
    };
  }
  return { ok: true, idea: match };
}

function parsePick(
  pick: unknown,
): { artifactId: string; representationRevisionId: string } | null {
  let value: unknown = pick;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { artifactId?: unknown; representationRevisionId?: unknown };
  if (typeof v.artifactId !== "string" || v.artifactId.length === 0) return null;
  if (
    typeof v.representationRevisionId !== "string" ||
    v.representationRevisionId.length === 0
  ) {
    return null;
  }
  return {
    artifactId: v.artifactId,
    representationRevisionId: v.representationRevisionId,
  };
}

/** The artifact ids a set of relation rows takes off the list: every row that is
 *  not released. A reservation with an expiry in the past is already released by
 *  the runner's sweep, so state alone is read here. */
export function takenArtifactIdsFromRows(
  rows: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const taken: string[] = [];
  for (const row of rows) {
    const state = typeof row.state === "string" ? row.state : "";
    if (state === RELEASED_RELATION_STATE) continue;
    const id = typeof row.idea_artifact_id === "string" ? row.idea_artifact_id : "";
    if (id.length > 0) taken.push(id);
  }
  return taken;
}
