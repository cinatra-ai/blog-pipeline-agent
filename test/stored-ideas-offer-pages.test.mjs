/**
 * THE OFFER, READ PAGE BY PAGE (blog-pipeline-agent#70).
 *
 * The arms pin how the idea step walks the stored-ideas list:
 *   P1 a free idea beyond the first page is offered, and a page that comes back
 *      short or empty with a next-page mark does not end the walk;
 *   P2 an empty list reads as today: one list request and the empty-list answer;
 *   P3 one full page reads as today: one list request and a hundred ideas;
 *   P4 the number stays the ceiling of what is offered, and the walk is bounded
 *      to ten pages.
 *
 *   node --test test/stored-ideas-offer-pages.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extensionTool } from "../cinatra/tools/stored-ideas.mjs";

const IDEA_TYPE = "blog-idea-type-under-test";

const ideaId = (n) => `idea-${String(n).padStart(3, "0")}`;
const ids = (from, to) => {
  const out = [];
  for (let n = from; n <= to; n += 1) out.push(ideaId(n));
  return out;
};

/**
 * Ports of this file's own. `pages` is the listing: each entry is the page's
 * artifact ids and the mark it answers for the next page. Every list request is
 * recorded; a cursor the listing did not write is refused, as the list road does.
 */
function ports({ pages, taken = [] }) {
  const listRequests = [];
  const contentReads = [];
  const issued = new Set();
  const cursorOf = (index) => {
    const cursor = `cursor-${index}`;
    issued.add(cursor);
    return cursor;
  };
  return {
    listRequests,
    contentReads,
    data: {
      async select() {
        const rows = taken.map((id) => ({
          idea_artifact_id: id,
          idea_revision_id: `${id}-rev`,
          state: "drafted",
          draft_artifact_id: `draft-of-${id}`,
          expires_at: null,
        }));
        return { rows, rowCount: rows.length };
      },
    },
    artifacts: {
      async list(request) {
        listRequests.push({ ...request });
        assert.deepEqual(request.types, [IDEA_TYPE]);
        let index = 0;
        if (request.cursor !== undefined) {
          assert.ok(issued.has(request.cursor), `a cursor the listing did not write is refused: ${request.cursor}`);
          index = Number(/^cursor-(\d+)$/.exec(request.cursor)[1]);
        }
        const page = pages[index] ?? { ids: [], next: false };
        return {
          artifacts: page.ids.map((id) => ({
            artifactId: id,
            latestRepresentationRevisionId: `${id}-rev`,
          })),
          nextCursor: page.next ? cursorOf(index + 1) : null,
        };
      },
      async contentRead(request) {
        contentReads.push(request.artifactId);
        return { artifactId: request.artifactId, text: `Title: Idea ${request.artifactId}\n\nBody.` };
      },
    },
    review: {
      file() {
        throw new Error("prepare files no review");
      },
    },
    clock: {
      now() {
        return new Date("2026-09-30T10:00:00.000Z");
      },
    },
  };
}

const prepare = (p) => extensionTool({ input: { op: "prepare", ideaType: IDEA_TYPE }, ports: p });

describe("the offer reads the stored-ideas list page by page", () => {
  it("P1: a free idea beyond the first page is offered", async () => {
    const p = ports({
      pages: [
        { ids: ids(1, 100), next: true },
        { ids: [], next: true },
        { ids: [ideaId(101), ideaId(102)], next: false },
      ],
      taken: [...ids(1, 100), ideaId(101)],
    });
    const offer = await prepare(p);
    assert.equal(offer.ok, true, "a free idea further down the list is offered");
    assert.deepEqual(
      offer.ideas.map((idea) => idea.artifactId),
      [ideaId(102)],
    );
    assert.equal(offer.ideas[0].title, `Idea ${ideaId(102)}`);
    assert.deepEqual(p.listRequests, [
      { types: [IDEA_TYPE], limit: 100 },
      { types: [IDEA_TYPE], limit: 100, cursor: "cursor-1" },
      { types: [IDEA_TYPE], limit: 100, cursor: "cursor-2" },
    ]);
    assert.deepEqual(p.contentReads, [ideaId(102)], "one content read per offered idea");
  });

  it("P2: an empty list reads as today", async () => {
    const p = ports({ pages: [{ ids: [], next: false }] });
    const offer = await prepare(p);
    assert.equal(offer.ok, false);
    assert.deepEqual(offer.ideas, []);
    assert.match(offer.reason, /no blog idea left to draft/);
    assert.deepEqual(p.listRequests, [{ types: [IDEA_TYPE], limit: 100 }]);
    assert.deepEqual(p.contentReads, []);
  });

  it("P3: one full page of free ideas reads as today", async () => {
    const p = ports({ pages: [{ ids: ids(1, 100), next: true }, { ids: ids(101, 150), next: false }] });
    const offer = await prepare(p);
    assert.equal(offer.ok, true);
    assert.deepEqual(
      offer.ideas.map((idea) => idea.artifactId),
      ids(1, 100),
    );
    assert.deepEqual(p.listRequests, [{ types: [IDEA_TYPE], limit: 100 }]);
    assert.equal(p.contentReads.length, 100);
  });

  it("P4: the number stays the ceiling and the walk is bounded", async () => {
    // The ceiling holds across pages: sixty free ideas on each of two pages
    // offer a hundred, and no third page is asked for.
    const across = ports({
      pages: [
        { ids: ids(1, 60), next: true },
        { ids: ids(61, 120), next: true },
        { ids: ids(121, 130), next: false },
      ],
    });
    const full = await prepare(across);
    assert.equal(full.ok, true);
    assert.deepEqual(
      full.ideas.map((idea) => idea.artifactId),
      ids(1, 100),
    );
    assert.equal(across.listRequests.length, 2);
    assert.equal(across.contentReads.length, 100);

    // The walk stops after ten pages even when the listing answers a next mark:
    // a free idea on the eleventh page is not reached.
    const pages = [];
    for (let n = 0; n < 10; n += 1) pages.push({ ids: [ideaId(n + 1)], next: true });
    pages.push({ ids: [ideaId(11)], next: false });
    const bounded = ports({ pages, taken: ids(1, 10) });
    const empty = await prepare(bounded);
    assert.equal(empty.ok, false);
    assert.deepEqual(empty.ideas, []);
    assert.equal(bounded.listRequests.length, 10);
    assert.deepEqual(bounded.contentReads, []);
  });
});
