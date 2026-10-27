/**
 * THE BRAND VOICE AS TEXT, as the tool this pack DECLARES.
 *
 * The host hands a step the brand voice picked for this run as the binding of
 * its `brandVoice` context slot: `[{ slotId: "brandVoice", refs: [...] }]`, where
 * each ref names a stored artifact and its revision and carries none of its
 * text. A step that writes in that voice needs the text, and reading an
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
 * A PDF CANNOT BE PICKED AWAY. A brand-voice artifact may be stored as a PDF,
 * and a context slot cannot limit the forms a person picks from. The content
 * read admits text forms only, so a PDF pick stops the run here, with the
 * sentence below, before anything is written.
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

/** The sentences a person reads. Each is one line, with no path and no id, so
 *  the host repeats it as it stands. */
const PDF_REASON = "This brand voice is a PDF; pick a text brand voice.";
const UNREADABLE_REASON = "The chosen brand voice cannot be read; pick another brand voice.";
const TOO_LONG_REASON = "This brand voice is too long to read; pick a shorter brand voice.";
const EMPTY_REASON = "This brand voice has no text; pick another brand voice.";
const MORE_THAN_ONE_REASON = "More than one brand voice was picked; pick exactly one brand voice.";
const NO_BINDING_REASON =
  "The brand voice for this run did not reach this step; start the run again.";

/** The name the host's dispatch reads a module's refusal by: the run stops with
 *  the sentence, which the host repeats. */
const REFUSAL_NAME = "ExtensionToolCallRefusal";

/** The content read's own class for a representation that is not text. */
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

/** The refs of the brand-voice slot. A binding list without that slot is not
 *  this step's binding and is refused. */
function brandVoiceRefs(bindings) {
  const entries = bindings.filter((b) => isPlainObject(b) && b.slotId === SLOT_ID);
  if (entries.length !== 1 || !Array.isArray(entries[0].refs)) {
    throw new BrandVoiceRefusal(NO_BINDING_REASON);
  }
  return entries[0].refs;
}

/**
 * THE ONE CALLABLE EXPORT the declared-tools contract pins: one function of one
 * argument, `{ input, ports }`. Input: `{ bindings }`. Result: `{ brandVoiceText }`.
 */
export async function extensionTool({ input, ports }) {
  const call = isPlainObject(input) ? input : {};
  const refs = brandVoiceRefs(bindingsOf(call.bindings));
  if (refs.length === 0) return { brandVoiceText: "" };
  if (refs.length > 1) throw new BrandVoiceRefusal(MORE_THAN_ONE_REASON);
  const ref = refs[0];
  if (!isPlainObject(ref) || typeof ref.artifactId !== "string" || ref.artifactId.trim() === "") {
    throw new BrandVoiceRefusal(NO_BINDING_REASON);
  }
  let read;
  try {
    read = await ports.artifacts.contentRead({
      artifactId: ref.artifactId,
      ...(typeof ref.representationRevisionId === "string" && ref.representationRevisionId !== ""
        ? { representationRevisionId: ref.representationRevisionId }
        : {}),
    });
  } catch (e) {
    const reason = typeof e === "object" && e !== null ? e.reason : undefined;
    throw new BrandVoiceRefusal(reason === NOT_TEXT ? PDF_REASON : UNREADABLE_REASON);
  }
  if (!isPlainObject(read) || typeof read.text !== "string") {
    throw new BrandVoiceRefusal(UNREADABLE_REASON);
  }
  if (read.truncated === true) throw new BrandVoiceRefusal(TOO_LONG_REASON);
  if (read.text.trim() === "") throw new BrandVoiceRefusal(EMPTY_REASON);
  return { brandVoiceText: read.text };
}
