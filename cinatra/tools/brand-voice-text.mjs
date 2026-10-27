/**
 * THE BRAND VOICE AS TEXT, as the tool this pack DECLARES.
 *
 * The host hands a step the brand voice picked for this run as the binding of
 * its `brandVoice` context slot: `[{ slotId: "brandVoice", refs: [...] }]`, where
 * each ref names a stored artifact, its type and its revision and carries none
 * of its text. A step that writes in that voice needs the text, and reading an
 * artifact's content is this pack's own job. So the read step in front of the
 * writing step calls this module through the host's generic dispatch, and the
 * module reads the one picked artifact through the content read the host binds
 * to this run (`ports.artifacts.contentRead`), admitted for the brand-voice
 * artifact this pack declares as a dependency.
 *
 * NEVER WITHOUT THE VOICE. A run that was given a brand voice either gets its
 * text or stops with one sentence a person can act on. Only a pick of nothing
 * (an optional slot left empty when this agent runs on its own) gives the empty
 * text, and the step then writes as it did before brand voices existed.
 *
 * ONLY A BRAND VOICE IS READ AS ONE. The content read admits every artifact type
 * this pack declares (a blog idea or a blog post too), so it cannot tell a brand
 * voice from them. Before the read, the module asks the host's own listing of
 * brand-voice artifacts (`ports.artifacts.list`, narrowed to that one type)
 * whether the picked artifact is among them. A ref that names another type, or
 * an artifact the listing holds under another type, stops the run as not a
 * brand voice. An artifact the listing does not hold stops the run as a brand
 * voice that cannot be read. Its text is never read.
 *
 * KNOWN LIMIT: ONE PAGE OF THE LISTING. The module reads the first page of the
 * listing only (500 brand voices, the host's page ceiling, newest first) and
 * does not ask for the next page. A brand voice that is not on that first page,
 * the 501st and older of an organization with more, is refused with the
 * sentence that asks for another brand voice, and nothing is read. The run
 * stops; it never runs on an artifact the listing did not show.
 *
 * A PDF CANNOT BE PICKED AWAY. A brand-voice artifact may be stored as a PDF,
 * and a context slot cannot limit the forms a person picks from. The content
 * read admits text forms only, so a PDF pick stops the run here, with the
 * sentence below, before anything is written.
 *
 * A FAILURE IS NOT A PICK TO CHANGE. Only the content read's own refusal of the
 * picked artifact, or a pick the first page of the listing does not hold,
 * becomes a sentence that asks for another brand voice. Any other error (a
 * failed listing, a store fault, a refusal of this pack's declaration) is
 * thrown on as it is, so the host answers it as the failure it is and never as
 * the person's choice.
 *
 * The bindings arrive as JSON text (a step that a parent hands the pick to gets
 * it on a text input) or, in a flow's own graph, as the list itself. Both are
 * read the same way.
 *
 * THIS FILE IS THE SHIPPED ARTIFACT: `files` ships `cinatra/`. The same file is
 * shipped by blog-draft-writer-agent, blog-image-generator-agent and
 * blog-pipeline-agent, because the host resolves the tool against the pack
 * whose run calls it.
 */

/** The slot whose pick this module reads. */
const SLOT_ID = "brandVoice";

/** The one artifact type a brand voice is. */
const BRAND_VOICE_TYPE = "@cinatra-ai/brand-voice-artifact";

/** The one page of the listing the module reads: 500 brand voices, the host's
 *  page ceiling. A pick not on it is refused (see KNOWN LIMIT above). */
const LISTING_PAGE_LIMIT = 500;

/** The sentences a person reads. Each is one line, with no path and no id, so
 *  the host repeats it as it stands. */
const PDF_REASON = "This brand voice is a PDF; pick a text brand voice.";
const UNREADABLE_REASON = "The chosen brand voice cannot be read; pick another brand voice.";
const TOO_LONG_REASON = "This brand voice is too long to read; pick a shorter brand voice.";
const EMPTY_REASON = "This brand voice has no text; pick another brand voice.";
const MORE_THAN_ONE_REASON = "More than one brand voice was picked; pick exactly one brand voice.";
const NOT_A_BRAND_VOICE_REASON = "The chosen item is not a brand voice; pick a brand voice.";
const NO_BINDING_REASON =
  "The brand voice for this run did not reach this step; start the run again.";

/** Every sentence this module can stop a run with, for the checks that hold
 *  each one to the host's bounds. */
export const REFUSAL_SENTENCES = Object.freeze([
  PDF_REASON,
  UNREADABLE_REASON,
  TOO_LONG_REASON,
  EMPTY_REASON,
  MORE_THAN_ONE_REASON,
  NOT_A_BRAND_VOICE_REASON,
  NO_BINDING_REASON,
]);

/** The name the host's dispatch reads a module's refusal by: the run stops with
 *  the sentence, which the host repeats. */
const REFUSAL_NAME = "ExtensionToolCallRefusal";

/** The content read's own refusal, by the name its class sets, and its reason
 *  for a representation that is not text. */
const CONTENT_REFUSAL_NAME = "ArtifactContentRefusal";
const NOT_TEXT = "not-text";

class BrandVoiceRefusal extends Error {
  constructor(sentence) {
    super(sentence);
    this.name = REFUSAL_NAME;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** The bindings as a list, or a refusal. Any shape but the host's is refused:
 *  a binding this module cannot read is never read as "no brand voice". */
function bindingsOf(raw) {
  let value = raw;
  if (typeof value === "string") {
    if (value.trim() === "") throw new BrandVoiceRefusal(NO_BINDING_REASON);
    try {
      value = JSON.parse(value);
    } catch {
      throw new BrandVoiceRefusal(NO_BINDING_REASON);
    }
  }
  if (!Array.isArray(value)) throw new BrandVoiceRefusal(NO_BINDING_REASON);
  return value;
}

/** The refs of the brand-voice slot. The step's binding is exactly one entry,
 *  the brand-voice slot's; a list with anything else in it is not this step's
 *  binding and is refused. */
function brandVoiceRefs(bindings) {
  if (bindings.length !== 1) throw new BrandVoiceRefusal(NO_BINDING_REASON);
  const entry = bindings[0];
  if (!isPlainObject(entry) || entry.slotId !== SLOT_ID || !Array.isArray(entry.refs)) {
    throw new BrandVoiceRefusal(NO_BINDING_REASON);
  }
  return entry.refs;
}

/** The one picked ref, checked for the fields the read needs. A ref that names
 *  another artifact type is not a brand voice. */
function pickedRef(refs) {
  if (refs.length > 1) throw new BrandVoiceRefusal(MORE_THAN_ONE_REASON);
  const ref = refs[0];
  if (!isPlainObject(ref) || !isNonBlankString(ref.artifactId)) {
    throw new BrandVoiceRefusal(NO_BINDING_REASON);
  }
  if ("representationRevisionId" in ref && !isNonBlankString(ref.representationRevisionId)) {
    throw new BrandVoiceRefusal(NO_BINDING_REASON);
  }
  if (ref.extension !== BRAND_VOICE_TYPE) throw new BrandVoiceRefusal(NOT_A_BRAND_VOICE_REASON);
  return ref;
}

/** Checks the pick against the first page of the host's brand-voice listing,
 *  and refuses it unless the page holds it as a brand voice. A failed listing is
 *  thrown on as it is. */
async function checkListedBrandVoice(ports, artifactId) {
  const page = await ports.artifacts.list({
    types: [BRAND_VOICE_TYPE],
    limit: LISTING_PAGE_LIMIT,
  });
  const artifacts = isPlainObject(page) && Array.isArray(page.artifacts) ? page.artifacts : [];
  const listed = artifacts.find((a) => isPlainObject(a) && a.artifactId === artifactId);
  // Not on the first page: another type, or a brand voice past the 500th.
  if (listed === undefined) throw new BrandVoiceRefusal(UNREADABLE_REASON);
  if (listed.artifactType !== undefined && listed.artifactType !== BRAND_VOICE_TYPE) {
    throw new BrandVoiceRefusal(NOT_A_BRAND_VOICE_REASON);
  }
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`. Input: `{ bindings }`. Result: `{ brandVoiceText }`.
 */
export async function extensionTool({ input, ports }) {
  const call = isPlainObject(input) ? input : {};
  const refs = brandVoiceRefs(bindingsOf(call.bindings));
  if (refs.length === 0) return { brandVoiceText: "" };
  const ref = pickedRef(refs);
  await checkListedBrandVoice(ports, ref.artifactId);
  let read;
  try {
    read = await ports.artifacts.contentRead({
      artifactId: ref.artifactId,
      ...("representationRevisionId" in ref
        ? { representationRevisionId: ref.representationRevisionId }
        : {}),
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && e.name === CONTENT_REFUSAL_NAME) {
      throw new BrandVoiceRefusal(e.reason === NOT_TEXT ? PDF_REASON : UNREADABLE_REASON);
    }
    throw e;
  }
  if (!isPlainObject(read) || typeof read.text !== "string") {
    throw new BrandVoiceRefusal(UNREADABLE_REASON);
  }
  if (read.truncated === true) throw new BrandVoiceRefusal(TOO_LONG_REASON);
  if (read.text.trim() === "") throw new BrandVoiceRefusal(EMPTY_REASON);
  return { brandVoiceText: read.text };
}
