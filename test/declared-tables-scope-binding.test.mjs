/**
 * THE RESERVATION TABLE'S HOST-BOUND COLUMNS, pinned against the rules the host
 * states for a declaration it reads.
 *
 * The generic dispatch hands a declared module ports that are already bound: the
 * organisation, the RUN a row belongs to, and the SCOPE that run was launched
 * from. A module therefore never holds a run identity or a scope identity — but
 * the host can only bind what the declaration names, so the binding is declared
 * here:
 *
 *   - `runColumn` names the column carrying the run a row belongs to;
 *   - `scopeKindColumn` and `scopeIdColumn` are declared as a PAIR — a kind
 *     names no scope without an id, and an id names no vocabulary without a
 *     kind;
 *   - every one of them names one of the table's OWN declared columns, is not
 *     the organisation column, carries one binding each (no column stands for
 *     two), and is declared `notNull: true` — a nullable binding is a row
 *     belonging to no run and no scope.
 *
 * Those rules are RE-STATED here as the host's own parser states them, so this
 * pack is checked by the same rules rather than by a copy of the host's parser: a
 * declaration that would be refused at the seam is refused here first.
 *
 *   node --test test/declared-tables-scope-binding.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** The reservation table, as this pack declares it and the module names it. */
const TABLE = "idea_drafts";

function table() {
  const tables = manifest.cinatra.declaredTables;
  assert.ok(Array.isArray(tables), "cinatra.declaredTables is an array");
  const found = tables.find((t) => t && t.name === TABLE);
  assert.ok(found, `the pack declares its reservation table "${TABLE}"`);
  return found;
}

/**
 * Why one host-bound column declaration would be refused, or null when it is
 * admitted — the rule the host's own declared-tables parser applies to each of
 * `runColumn`, `scopeKindColumn` and `scopeIdColumn`.
 */
function boundColumnIssue(entry, field, takenBy) {
  const raw = entry[field];
  if (raw === undefined || raw === null) return null;
  const columns = Array.isArray(entry.columns) ? entry.columns : [];
  const names = new Set(columns.map((c) => c && c.name));
  if (typeof raw !== "string" || !names.has(raw)) {
    return `${field} must name one of the table's own columns`;
  }
  if (raw === entry.organizationColumn) {
    return `${field} is already the organisation column`;
  }
  const already = takenBy.get(raw);
  if (already) return `${field} is already the ${already} column`;
  const column = columns.find((c) => c && c.name === raw);
  if (!column || column.notNull !== true) {
    return `the ${field} column must be declared \`notNull: true\``;
  }
  takenBy.set(raw, field);
  return null;
}

/** Why the scope pair would be refused: one half without the other names no
 *  scope the host could write. */
function scopePairIssue(entry) {
  const kind = entry.scopeKindColumn ?? null;
  const id = entry.scopeIdColumn ?? null;
  if ((kind === null) !== (id === null)) {
    return "the scope binding is declared as a PAIR";
  }
  return null;
}

test("the reservation table declares its run column and its scope pair", () => {
  const entry = table();
  assert.equal(entry.runColumn, "run_id", "the run a row belongs to");
  assert.equal(entry.scopeKindColumn, "scope_kind", "the kind of scope that run belongs to");
  assert.equal(entry.scopeIdColumn, "scope_id", "the id inside that kind");
});

test("the two scope columns are declared, notNull and text", () => {
  const entry = table();
  for (const name of ["scope_kind", "scope_id"]) {
    const column = entry.columns.find((c) => c && c.name === name);
    assert.ok(column, `the table declares the column "${name}"`);
    assert.equal(column.type, "text", `"${name}" is text`);
    assert.equal(column.notNull, true, `"${name}" is notNull — a nullable scope is no scope`);
  }
});

test("each binding is admitted by the host's own rule, refusal by refusal", () => {
  const entry = table();
  const takenBy = new Map();
  assert.equal(boundColumnIssue(entry, "runColumn", takenBy), null);
  assert.equal(boundColumnIssue(entry, "scopeKindColumn", takenBy), null);
  assert.equal(boundColumnIssue(entry, "scopeIdColumn", takenBy), null);
  assert.equal(scopePairIssue(entry), null);

  // The same cases the host's parser states. Without them the checks above could
  // pass against a rule this pack invented.
  const columns = [
    { name: "org_id", type: "text", notNull: true },
    { name: "run_id", type: "text", notNull: true },
    { name: "scope_kind", type: "text", notNull: true },
    { name: "scope_id", type: "text" },
  ];
  const base = { name: TABLE, organizationColumn: "org_id", columns };
  assert.match(
    boundColumnIssue({ ...base, runColumn: "nope" }, "runColumn", new Map()),
    /must name one of the table's own columns/,
  );
  assert.match(
    boundColumnIssue({ ...base, runColumn: "org_id" }, "runColumn", new Map()),
    /already the organisation column/,
  );
  assert.match(
    boundColumnIssue({ ...base, scopeIdColumn: "scope_id" }, "scopeIdColumn", new Map()),
    /must be declared/,
  );
  const shared = new Map();
  assert.equal(boundColumnIssue({ ...base, runColumn: "run_id" }, "runColumn", shared), null);
  assert.match(
    boundColumnIssue({ ...base, scopeKindColumn: "run_id" }, "scopeKindColumn", shared),
    /already the runColumn column/,
  );
  assert.match(scopePairIssue({ ...base, scopeKindColumn: "scope_kind" }), /declared as a PAIR/);
  assert.match(scopePairIssue({ ...base, scopeIdColumn: "scope_kind" }), /declared as a PAIR/);
});

test("the unique reservation rule still arbitrates the race, and the scope has its own index", () => {
  const entry = table();
  const indexes = Array.isArray(entry.indexes) ? entry.indexes : [];
  const unique = indexes.find((i) => i && i.unique === true);
  assert.ok(unique, "the table keeps its unique reservation index");
  assert.deepEqual(
    unique.columns,
    ["org_id", "idea_artifact_id", "state"],
    "one live row per idea — the rule of which two runs offering one idea only one takes it",
  );
  const byScope = indexes.find(
    (i) => i && !i.unique && Array.isArray(i.columns) && i.columns.includes("scope_kind"),
  );
  assert.ok(byScope, "the table carries a by-scope index");
  assert.deepEqual(byScope.columns, ["org_id", "scope_kind", "scope_id"]);
  for (const index of indexes) {
    for (const column of index.columns) {
      assert.ok(
        entry.columns.some((c) => c && c.name === column),
        `index "${index.name}" names the declared column "${column}"`,
      );
    }
  }
});
