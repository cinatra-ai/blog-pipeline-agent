/**
 * THE PIPELINE'S STORED-IDEAS GATE, as the tool this pack DECLARES.
 *
 * The gate no longer travels through a tool of the runtime's own: the host
 * admits one generic dispatch on its passthrough, resolves the name a call asks
 * for against the CALLING pack's own manifest, loads the module that manifest
 * declares from this pack's own tree at the pinned lock, and calls the one export
 * the contract names with the ports. So the three steps of the flow — the
 * preparation in front of the gate, the pick, and the completion after the draft
 * is written — are this pack's code, and the runtime keeps no knowledge of a blog
 * idea, a reservation or a draft.
 *
 * THIS IS THE SHIPPED ARTIFACT. `cinatra.files` ships `cinatra/`, so the module
 * the declaration names lives here rather than beside the pack's TypeScript
 * sources; the decisions it carries are the ones the pack's own decision module
 * states, and `test/stored-ideas-tool-module.test.mjs` pins the sentences a
 * person reads against that module so the two cannot drift apart.
 *
 * NEITHER THE RUN NOR THE SCOPE IS EVER IN THIS FILE. The ports are already
 * bound: the host writes the organisation, the run and the scope on a write, and
 * a read asks for this run's own rows with `{ boundRun: true }` on the declared
 * run column and for this scope's own rows with `{ boundScope: true }` on the
 * declared scope columns. A literal on one of those columns is refused at the
 * seam, and no run id and no scope id appears anywhere in this pack.
 */

/** The reservation table, as this pack's manifest declares it. */
const TABLE = "idea_drafts";
/** The host-bound columns of that table, named here only to ask for "mine". */
const RUN_COLUMN = "run_id";
const SCOPE_KIND_COLUMN = "scope_kind";
const SCOPE_ID_COLUMN = "scope_id";
/** The two markers the data contract defines, and the only values those columns
 *  take in a request. */
const BOUND_RUN = Object.freeze({ boundRun: true });
const BOUND_SCOPE = Object.freeze({ boundScope: true });

/** A row is live — it takes its idea off the list — until it is released. */
const RESERVED = "reserved";
const DRAFTED = "drafted";
const RELEASED = "released";

/** How many stored ideas one gate reads content for. A person choosing from more
 *  than this is choosing from a list nobody reads, and each entry costs a read. */
const MAX_OFFERED_IDEAS = 100;

/** Two days: long enough for a run that parks at a review over a weekend, short
 *  enough that an abandoned run does not hold an idea for ever. */
const RESERVATION_TTL_MS = 48 * 60 * 60 * 1000;

/** The sentences a person reads, as the pack's decision module states them. */
const IDEA_TAKEN_REASON =
  "That blog idea was just taken by another run. The list has been refreshed — pick another one.";
const EMPTY_LIST_REASON =
  "There is no blog idea left to draft: every stored idea already has a draft or is reserved by " +
  "another run. Generate new ideas, then start the pipeline again.";
const NO_LIST_REASON =
  "The idea gate has no offered list to validate a pick against, so no idea can be taken. " +
  "The run stops rather than drafting an idea nobody chose.";
const NOTHING_PICKED_REASON =
  "No blog idea was chosen at the idea gate. Pick exactly one idea from the list — nothing " +
  "is chosen for you.";
const notOfferedReason = (artifactId, offeredCount) =>
  `The chosen idea (${artifactId}) is not one of the ${offeredCount} ideas the ` +
  "gate offered, or it has been rewritten since the list was drawn. Refresh the list and pick again.";
const RESERVATION_WRITE_FAILED_REASON =
  `The reservation for this blog idea could not be written to ${TABLE}, so the ` +
  "run stops rather than drafting an idea another run may also be drafting.";

/** A refusal raised before anything is read or written. `reason` is the
 *  machine-readable class the passthrough reports it under; the shape is the one
 *  the runtime recognises without importing anything of this pack's. */
class IdeaTypeRefusal extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "IdeaTypeRefusal";
    this.reason = reason;
  }
}

function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * THE CALLING EXTENSION NAMES THE TYPE, NEVER THE HOST: the type an idea is filed
 * under is this pack's own declared dependency, so the flow node passes it. A
 * call that names none is refused rather than widened to every type this pack may
 * read — the offer would then be a list of posts and pictures.
 */
function requireIdeaType(input) {
  const ideaType = text(input.ideaType).trim();
  if (ideaType.length === 0) {
    throw new IdeaTypeRefusal(
      "invalid-request",
      "stored_ideas: `ideaType` is required — the calling extension names the artifact type " +
        "its ideas are filed under, and it must be one of its own declared dependencies",
    );
  }
  return ideaType;
}

/** The idea's title is the FIRST LINE of its text; the generator's `Title:`
 *  prefix is read off rather than shown. */
function titleFromIdeaText(value) {
  const firstLine = text(value).split(/\r?\n/, 1)[0]?.trim() ?? "";
  return firstLine.replace(/^title\s*:\s*/i, "").trim();
}

/** This scope's own rows, asked for the one way the data contract admits. */
function scopeWhere() {
  return { [SCOPE_KIND_COLUMN]: BOUND_SCOPE, [SCOPE_ID_COLUMN]: BOUND_SCOPE };
}

/** The reservation rows of the scope this run belongs to. NOT this run's alone:
 *  a reservation a sibling run took is exactly what this run must not take
 *  again, so the run column is not named here. */
async function selectRelationRows(ports) {
  const answer = await ports.data.select({
    table: TABLE,
    where: { ...scopeWhere() },
    limit: 1000,
  });
  const rows = answer && Array.isArray(answer.rows) ? answer.rows : [];
  return rows;
}

/** The artifact ids a set of rows takes off the list: every row that is not
 *  released. A lapsed reservation is already released by the sweep below, so
 *  state alone is read here. */
function takenArtifactIds(rows) {
  const taken = [];
  for (const row of rows) {
    if (text(row.state) === RELEASED) continue;
    const id = text(row.idea_artifact_id);
    if (id.length > 0) taken.push(id);
  }
  return taken;
}

/**
 * The rows a sweep releases: a RESERVATION whose expiry has passed on the
 * injected clock, and nothing else. A relation (`drafted`) is not a reservation
 * and never lapses; a reservation with no expiry is held until its run releases
 * it; an unreadable expiry is left alone rather than guessed at.
 */
function expiredReservationRows(rows, now) {
  const at = now.getTime();
  return rows.filter((row) => {
    if (text(row.state) !== RESERVED) return false;
    const raw = row.expires_at;
    const expires =
      raw instanceof Date ? raw.getTime() : typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    return Number.isFinite(expires) && expires <= at;
  });
}

/**
 * Release every lapsed reservation, and answer with the rows that still take
 * their idea off the list.
 *
 * KEYED ON THE IDEA AND THE RESERVED STATE, read off the row: the sweep releases
 * reservations of runs that are not this one — that is the whole point of it —
 * and the run a row belongs to is the host's, never nameable in a request. The
 * reserved state is what keeps a row already completed into a relation standing,
 * so a finished draft never hands its idea back to the list, and the table's own
 * one-live-row-per-idea rule is what makes the idea an exact key. A release the
 * write refused leaves the idea taken for this offer, and the next preparation
 * sweeps again.
 */
async function releaseExpiredReservations(ports, rows, now) {
  const expired = expiredReservationRows(rows, now);
  if (expired.length === 0) return [...rows];
  const released = new Set();
  for (const row of expired) {
    const ideaArtifactId = text(row.idea_artifact_id);
    if (ideaArtifactId === "") continue;
    const written = await ports.data.updateWhere({
      table: TABLE,
      set: { state: RELEASED, expires_at: null },
      where: { idea_artifact_id: ideaArtifactId, state: RESERVED, ...scopeWhere() },
    });
    if ((written?.updated ?? 0) > 0) released.add(row);
  }
  return rows.filter((row) => !released.has(row));
}

/** The listing, as the dependency-scoped read road answers it: one page of
 *  artifact summaries, newest first. */
function artifactReferences(page) {
  const artifacts = Array.isArray(page?.artifacts) ? page.artifacts : [];
  const references = [];
  for (const artifact of artifacts) {
    const artifactId = text(artifact?.artifactId);
    if (artifactId === "") continue;
    references.push({
      artifactId,
      representationRevisionId: text(artifact?.latestRepresentationRevisionId),
    });
  }
  return references;
}

/** One idea's text. Null when the content cannot be read — a candidate with no
 *  readable text is still an idea, offered under an empty title rather than
 *  dropped, because dropping it would silently shrink the list. */
async function readIdeaText(ports, reference) {
  try {
    const read = await ports.artifacts.contentRead({
      artifactId: reference.artifactId,
      ...(reference.representationRevisionId
        ? { representationRevisionId: reference.representationRevisionId }
        : {}),
    });
    return typeof read?.text === "string" ? read.text : null;
  } catch {
    return null;
  }
}

/**
 * The list the gate offers. An empty list ends the run with the sentence it
 * carries, never with a pick nobody made.
 */
async function prepare(input, ports) {
  const ideaType = requireIdeaType(input);
  const now = ports.clock.now();
  const rows = await selectRelationRows(ports);
  // EXPIRED RESERVATIONS ARE RELEASED BEFORE THE OFFER IS SELECTED, ahead of the
  // subtraction and the reads: a lapsed reservation swept after the list was
  // drawn would hand its idea back to nobody, and the offer this run makes is the
  // list the sweep just widened.
  const live = await releaseExpiredReservations(ports, rows, now);
  const taken = new Set(takenArtifactIds(live));
  const references = artifactReferences(
    await ports.artifacts.list({ types: [ideaType], limit: MAX_OFFERED_IDEAS }),
  );
  // ONE CONTENT READ PER UNUSED IDEA, and none for an idea already taken: the
  // subtraction happens before the reads, so a list of a hundred ideas of which
  // two are free costs two reads.
  const ideas = [];
  const seen = new Set();
  for (const reference of references) {
    if (taken.has(reference.artifactId)) continue;
    if (seen.has(reference.artifactId)) continue;
    if (ideas.length >= MAX_OFFERED_IDEAS) break;
    seen.add(reference.artifactId);
    const read = await readIdeaText(ports, reference);
    const body = read ?? "";
    ideas.push({ ...reference, text: body, title: titleFromIdeaText(body) });
  }
  if (ideas.length === 0) return { ok: false, ideas: [], reason: EMPTY_LIST_REASON };
  return { ok: true, ideas, reason: "" };
}

/** A value the flow sends as JSON TEXT, read back. Both halves of a reservation
 *  arrive that way, so one rule parses them. */
function parseJsonish(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * The offered list as the RUN carries it. FAILS SOFT, unlike the pick: an
 * unreadable list is an EMPTY list, and an element that is not a usable
 * reference is dropped rather than rejecting the whole offer. Nothing is admitted
 * by this — the pick below still fails closed on an empty list.
 */
function parseOfferedIdeas(value) {
  const raw = parseJsonish(value);
  if (!Array.isArray(raw)) return [];
  const ideas = [];
  for (const element of raw) {
    if (!element || typeof element !== "object" || Array.isArray(element)) continue;
    const artifactId = text(element.artifactId);
    const representationRevisionId = text(element.representationRevisionId);
    if (artifactId === "" || representationRevisionId === "") continue;
    ideas.push({
      artifactId,
      representationRevisionId,
      title: text(element.title),
      text: text(element.text),
    });
  }
  return ideas;
}

/**
 * The person's pick, validated against the list they were shown. FAILS CLOSED in
 * every direction a silent first-idea default used to fill in: nothing picked, an
 * unparseable pick, a pick naming an artifact the list did not offer, a pick
 * naming a revision other than the offered one, and a list missing altogether.
 */
function resolveIdeaPick(pick, offered) {
  if (offered.length === 0) return { ok: false, reason: NO_LIST_REASON };
  const parsed = parseJsonish(pick);
  const artifactId = parsed && typeof parsed === "object" ? text(parsed.artifactId) : "";
  const revisionId =
    parsed && typeof parsed === "object" ? text(parsed.representationRevisionId) : "";
  if (artifactId === "" || revisionId === "") {
    return { ok: false, reason: NOTHING_PICKED_REASON };
  }
  const match = offered.find(
    (idea) => idea.artifactId === artifactId && idea.representationRevisionId === revisionId,
  );
  if (!match) return { ok: false, reason: notOfferedReason(artifactId, offered.length) };
  return { ok: true, idea: match };
}

/**
 * Take the picked idea for this run.
 *
 * THE UNIQUENESS RULE IS THE RACE'S ONLY ARBITER: the conditional insert either
 * lands or is refused by the table's own one-live-row-per-idea rule, so two runs
 * that offer the same idea at the same moment cannot both take it, however close
 * their picks are. The loser is told the idea was just taken; nothing is silently
 * re-picked for them. The organisation, the run and the scope are none of this
 * write's business — the host stamps all three.
 */
async function reserve(input, ports) {
  requireIdeaType(input);
  const outcome = resolveIdeaPick(input.pick, parseOfferedIdeas(input.offered));
  if (!outcome.ok) return { reason: outcome.reason };
  const idea = outcome.idea;
  const now = ports.clock.now();
  const written = await ports.data.insertIfAbsent({
    table: TABLE,
    row: {
      idea_artifact_id: idea.artifactId,
      idea_revision_id: idea.representationRevisionId,
      state: RESERVED,
      draft_artifact_id: null,
      expires_at: new Date(now.getTime() + RESERVATION_TTL_MS).toISOString(),
      created_at: now.toISOString(),
    },
    conflictKeys: ["idea_artifact_id", "state"],
  });
  if (written?.inserted === true) {
    return {
      idea: idea.text,
      ideaArtifactId: idea.artifactId,
      ideaRevisionId: idea.representationRevisionId,
      ideaTitle: idea.title === "" ? titleFromIdeaText(idea.text) : idea.title,
      reason: "",
    };
  }
  if (written?.conflict === true) return { reason: IDEA_TAKEN_REASON };
  return { reason: RESERVATION_WRITE_FAILED_REASON };
}

/**
 * Complete the reservation into the relation: this idea, this draft — and file
 * the revisions this run's review gate pins.
 *
 * KEYED BY THIS RUN AND THE IDEA, so a retry after a failure completes the SAME
 * row and never a second. The expiry is cleared because a drafted relation is not
 * a reservation and never lapses; the draft written before a later failure stays,
 * as an audited draft, and only its reservation is released.
 */
async function complete(input, ports) {
  requireIdeaType(input);
  const ideaArtifactId = text(input.ideaArtifactId);
  const draftArtifactId = text(input.draftArtifactId);
  const written = await ports.data.updateWhere({
    table: TABLE,
    set: { state: DRAFTED, draft_artifact_id: draftArtifactId, expires_at: null },
    where: { idea_artifact_id: ideaArtifactId, [RUN_COLUMN]: BOUND_RUN, ...scopeWhere() },
  });
  // THE FILING IS THE HOST'S TO VALIDATE. A set this module cannot read is
  // handed over as it arrived, so a malformed filing is refused with a stated
  // reason rather than silently dropped on the way to a review surface.
  if (input.reviewTargets !== undefined && input.reviewTargets !== null) {
    const parsed = parseJsonish(input.reviewTargets);
    const targets = parsed === null ? input.reviewTargets : parsed;
    if (!Array.isArray(targets) || targets.length > 0) ports.review.file(targets);
  }
  return { ok: (written?.updated ?? 0) > 0 };
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`. The three steps of the flow are its three
 * operations, and an operation it does not carry is refused rather than widened.
 */
export async function extensionTool({ input, ports }) {
  const call = input && typeof input === "object" ? input : {};
  const op = text(call.op).trim();
  if (op === "prepare") return prepare(call, ports);
  if (op === "reserve") return reserve(call, ports);
  if (op === "complete") return complete(call, ports);
  throw new IdeaTypeRefusal(
    "invalid-request",
    "stored_ideas: `op` must be one of prepare, reserve or complete — " +
      `got ${JSON.stringify(call.op)}`,
  );
}
