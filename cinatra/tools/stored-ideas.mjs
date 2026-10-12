/**
 * THE PIPELINE'S STORED-IDEAS GATE, as the tool this pack DECLARES.
 *
 * The gate no longer travels through a tool of the runtime's own: the host
 * admits one generic dispatch on its passthrough, resolves the name a call asks
 * for against the CALLING pack's own manifest, loads the module that manifest
 * declares from this pack's own tree at the pinned lock, and calls the one export
 * the contract names with the ports. So the four steps of the flow — the
 * preparation in front of the gate, the pick, the completion after the draft is
 * written, and the filing of the LinkedIn post's review set — are this pack's
 * code, and the runtime keeps no knowledge of a blog
 * idea, a reservation or a draft.
 *
 * THIS IS THE SHIPPED ARTIFACT. `cinatra.files` ships `cinatra/`, so the module
 * the declaration names lives here rather than beside the pack's TypeScript
 * sources; the decisions it carries are the ones the pack's own decision module
 * states, and `test/stored-ideas-tool-module.test.mjs` pins the sentences a
 * person reads against that module so the two cannot drift apart.
 *
 * THE RUN IS NEVER IN THIS FILE. The ports are already bound: the host writes
 * the organisation and the run on a write and narrows every statement to the
 * organisation, and a read asks for this run's own rows with `{ boundRun: true }`
 * on the declared run column. A literal on either column is refused at the seam,
 * and no run id appears anywhere in this pack.
 *
 * THE RESERVATIONS ARE THE ORGANISATION'S. The offer lists every stored idea of
 * the organisation and the table's one-live-row-per-idea rule is
 * organisation-wide, so the table binds no launch scope: a run launched from any
 * page, from a schedule or from another agent reads and takes the same list.
 */

/** The reservation table, as this pack's manifest declares it. */
const TABLE = "idea_claims";
/** The host-bound run column of that table, named here only to ask for "mine". */
const RUN_COLUMN = "run_id";
/** The marker the data contract defines, and the only value that column takes in
 *  a request. */
const BOUND_RUN = Object.freeze({ boundRun: true });

/** The active key remains held through drafting; released history keeps no key. */
const RESERVED = "reserved";
const DRAFTED = "drafted";
const RELEASED = "released";

/** How many stored ideas one gate reads content for. A person choosing from more
 *  than this is choosing from a list nobody reads, and each entry costs a read. */
const MAX_OFFERED_IDEAS = 100;
/** How many pages of the list one gate reads: a bounded walk, the same bound the
 *  replaced gate kept. */
const MAX_LISTING_PAGES = 10;

/** Two days: long enough for a run that parks at a review over a weekend, short
 *  enough that an abandoned run does not hold an idea for ever. */
const RESERVATION_TTL_MS = 48 * 60 * 60 * 1000;

/** The sentences a person reads, as the pack's decision module states them. */
const IDEA_TAKEN_REASON =
  "That blog idea was just taken by another run. The list has been refreshed — pick another one.";
const EMPTY_LIST_REASON =
  "There is no blog idea left to draft: every stored idea already has a draft or is reserved by " +
  "another run. This list was read when the run reached this step, and it does not change while the " +
  "run waits here. Generate new ideas; the next run of this pipeline offers them.";
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

/** The active claim for one candidate, across this organisation's runs.
 * Released history has a NULL key, so it cannot exhaust this read's window.
 * UNIQUE(org_id, active_idea_key) makes the targeted equality match at most one
 * row. The host injects the organisation; a sibling run's claim must be seen. */
async function selectRelationRows(ports, ideaArtifactId) {
  const answer = await ports.data.select({
    table: TABLE,
    where: { active_idea_key: ideaArtifactId },
    limit: 1,
  });
  const rows = answer && Array.isArray(answer.rows) ? answer.rows : [];
  return rows;
}

/** The artifact ids a set of rows takes off the list: every row that is not
 *  released. A lapsed reservation is already released by the sweep below, so
 *  state alone is read here. */
function validClaimId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function takenArtifactIds(rows) {
  const taken = [];
  for (const row of rows) {
    if (row.active_idea_key === null) continue;
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
 * KEYED ON THE IMMUTABLE CLAIM AND ITS OBSERVED EXPIRY. A stale sweep cannot
 * release a renewed lease or a replacement claim. State and active key are
 * compared in the same update and the history row is retained. A refused
 * release keeps the idea taken for this offer, rather than guessing it free.
 */
async function releaseExpiredReservations(ports, rows, now) {
  const expired = expiredReservationRows(rows, now);
  if (expired.length === 0) return [...rows];
  const released = new Set();
  for (const row of expired) {
    const ideaArtifactId = text(row.idea_artifact_id);
    if (ideaArtifactId === "" || !validClaimId(row.claim_id)) continue;
    const written = await ports.data.updateWhere({
      table: TABLE,
      set: { state: RELEASED, active_idea_key: null, expires_at: null },
      where: { claim_id: row.claim_id, idea_artifact_id: ideaArtifactId, expires_at: row.expires_at },
      expect: { state: RESERVED, active_idea_key: ideaArtifactId },
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
 * The list the gate offers. The list is read page by page, with the mark each
 * page returns for the next one, until the offer is full, the list has ended or
 * the page bound is reached. An empty list ends the run with the sentence it
 * carries, never with a pick nobody made.
 */
async function prepare(input, ports) {
  const ideaType = requireIdeaType(input);
  const now = ports.clock.now();
  // ONE CONTENT READ PER UNUSED IDEA, and none for an idea already taken: the
  // subtraction happens before the reads, so a list of a hundred ideas of which
  // two are free costs two reads.
  const ideas = [];
  const seen = new Set();
  let cursor = null;
  for (let pageCount = 0; pageCount < MAX_LISTING_PAGES; pageCount += 1) {
    const page = await ports.artifacts.list({
      types: [ideaType],
      limit: MAX_OFFERED_IDEAS,
      ...(cursor === null ? {} : { cursor }),
    });
    for (const reference of artifactReferences(page)) {
      if (seen.has(reference.artifactId)) continue;
      if (ideas.length >= MAX_OFFERED_IDEAS) break;
      seen.add(reference.artifactId);
      // Read only this candidate's unique active key, then sweep its observed
      // lease before offering it. A refused CAS retains the idea as taken.
      const rows = await selectRelationRows(ports, reference.artifactId);
      const live = await releaseExpiredReservations(ports, rows, now);
      if (takenArtifactIds(live).includes(reference.artifactId)) continue;
      const read = await readIdeaText(ports, reference);
      const body = read ?? "";
      ideas.push({ ...reference, text: body, title: titleFromIdeaText(body) });
    }
    if (ideas.length >= MAX_OFFERED_IDEAS) break;
    // A page may come back short, even empty, with a mark for the next one, so
    // the walk ends on a missing mark and never on a short page.
    if (typeof page?.nextCursor !== "string" || page.nextCursor === "") break;
    cursor = page.nextCursor;
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
 * re-picked for them. The organisation and the run are none of this write's
 * business — the host stamps both.
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
      active_idea_key: idea.artifactId,
      idea_revision_id: idea.representationRevisionId,
      state: RESERVED,
      draft_artifact_id: null,
      expires_at: new Date(now.getTime() + RESERVATION_TTL_MS).toISOString(),
      created_at: now.toISOString(),
    },
    conflictKeys: ["active_idea_key"],
  });
  if (written?.inserted === true && validClaimId(written.row?.claim_id)) {
    return {
      idea: idea.text,
      claimId: written.row.claim_id,
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
 * KEYED BY THE DB-GENERATED CLAIM, THIS RUN AND THE IDEA. Completion never
 * revives an expired/released claim or acts on a successor. A retry succeeds
 * only for the same already-drafted claim and draft; it cannot overwrite it.
 * The active key stays held after drafting. Review filing is a separate host
 * operation, not part of the data statement's transaction.
 */
async function complete(input, ports) {
  requireIdeaType(input);
  const ideaArtifactId = text(input.ideaArtifactId);
  const draftArtifactId = text(input.draftArtifactId);
  const claimId = input.claimId;
  if (!validClaimId(claimId) || !ideaArtifactId.trim() || !draftArtifactId.trim()) return { ok: false };
  const observed = await ports.data.select({
    table: TABLE,
    where: { claim_id: claimId, idea_artifact_id: ideaArtifactId, [RUN_COLUMN]: BOUND_RUN },
    limit: 1,
  });
  const claim = Array.isArray(observed?.rows) ? observed.rows[0] : null;
  if (!claim) return { ok: false };
  const retryOfSameDraft = claim.state === DRAFTED && claim.active_idea_key === ideaArtifactId &&
    claim.draft_artifact_id === draftArtifactId;
  const expiry = claim.expires_at instanceof Date ? claim.expires_at.getTime() : Date.parse(claim.expires_at);
  if (!retryOfSameDraft && (claim.state !== RESERVED || claim.active_idea_key !== ideaArtifactId ||
    !Number.isFinite(expiry) || expiry <= ports.clock.now().getTime())) return { ok: false };
  const written = retryOfSameDraft ? { updated: 1 } : await ports.data.updateWhere({
    table: TABLE,
    set: { state: DRAFTED, draft_artifact_id: draftArtifactId, expires_at: null },
    where: { claim_id: claimId, idea_artifact_id: ideaArtifactId, [RUN_COLUMN]: BOUND_RUN },
    expect: { state: RESERVED, active_idea_key: ideaArtifactId, expires_at: claim.expires_at },
  });
  let ok = (written?.updated ?? 0) === 1;
  if (!ok) {
    const retry = await ports.data.select({
      table: TABLE,
      where: { claim_id: claimId, idea_artifact_id: ideaArtifactId, [RUN_COLUMN]: BOUND_RUN,
        state: DRAFTED, active_idea_key: ideaArtifactId, draft_artifact_id: draftArtifactId },
      limit: 1,
    });
    ok = Array.isArray(retry?.rows) && retry.rows.length === 1;
  }
  if (!ok) return { ok: false };
  // THE FILING IS THE HOST'S TO VALIDATE. A set this module cannot read is
  // handed over as it arrived, so a malformed filing is refused with a stated
  // reason rather than silently dropped on the way to a review surface.
  if (input.reviewTargets !== undefined && input.reviewTargets !== null) {
    const parsed = parseJsonish(input.reviewTargets);
    const targets = parsed === null ? input.reviewTargets : parsed;
    if (!Array.isArray(targets) || targets.length > 0) ports.review.file(targets);
  }
  return { ok };
}

/**
 * File the LinkedIn post's review set, and nothing else: no row is read or
 * written and no idea type is needed. The set is handed over whatever it holds —
 * a missing, empty or unreadable set too — so the host's parser refuses it with
 * its stated reason rather than a review opening on nothing.
 */
async function review(input, ports) {
  const parsed = parseJsonish(input.reviewTargets);
  const targets = parsed === null ? input.reviewTargets : parsed;
  ports.review.file(targets);
  return { ok: true };
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`. The four steps of the flow — the three above and
 * the filing of the LinkedIn post's review set — are its four operations, and an
 * operation it does not carry is refused rather than widened.
 */
export async function extensionTool({ input, ports }) {
  const call = input && typeof input === "object" ? input : {};
  const op = text(call.op).trim();
  if (op === "prepare") return prepare(call, ports);
  if (op === "reserve") return reserve(call, ports);
  if (op === "complete") return complete(call, ports);
  if (op === "review") return review(call, ports);
  throw new IdeaTypeRefusal(
    "invalid-request",
    "stored_ideas: `op` must be one of prepare, reserve, complete or review — " +
      `got ${JSON.stringify(call.op)}`,
  );
}
