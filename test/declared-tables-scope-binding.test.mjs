/**
 * THE RESERVATION TABLE'S HOST-BOUND COLUMNS, pinned against the rules the host
 * states for a declaration it reads.
 *
 * The generic dispatch hands a declared module ports that are already bound: the
 * organisation every statement stands inside, and the RUN a row belongs to. A
 * module therefore never holds a run identity — but the host can only bind what
 * the declaration names, so the binding is declared here:
 *
 *   - `organizationColumn` names the column the host writes and narrows every
 *     statement to;
 *   - `runColumn` names the column carrying the run a row belongs to; it names
 *     one of the table's OWN declared columns, is not the organisation column,
 *     and is declared `notNull: true` — a nullable binding is a row belonging to
 *     no run.
 *
 * THE TABLE DECLARES NO SCOPE PAIR. The offer lists every stored idea of the
 * organisation, and the table's one-live-row-per-idea rule is organisation-wide,
 * so a reservation belongs to the organisation and not to the place a run was
 * launched from. A scope pair would bind every read and write to the launch
 * scope the run recorded: a run launched with none would be refused outright,
 * and a run launched from one scope would offer again, and could draft again,
 * an idea reserved or drafted from another.
 *
 * The host's rule is RE-STATED here as its own parser states it, so this pack is
 * checked by the same rule rather than by a copy of the host's parser: a
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
/** The two columns a scope binding would name, and the index over them. */
const SCOPE_COLUMNS = ["scope_kind", "scope_id"];

function table() {
  const tables = manifest.cinatra.declaredTables;
  assert.ok(Array.isArray(tables), "cinatra.declaredTables is an array");
  const found = tables.find((t) => t && t.name === TABLE);
  assert.ok(found, `the pack declares its reservation table "${TABLE}"`);
  return found;
}

/**
 * Why one host-bound column declaration would be refused, or null when it is
 * admitted — the rule the host's own declared-tables parser applies to a bound
 * column such as `runColumn`.
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
    return `the ${field} column must be declared notNull: true`;
  }
  takenBy.set(raw, field);
  return null;
}

test("the reservation table binds the organisation and the run, and declares no scope pair", () => {
  const entry = table();
  assert.equal(entry.organizationColumn, "org_id", "the organisation every statement stands inside");
  assert.equal(entry.runColumn, "run_id", "the run a row belongs to");
  assert.equal(
    Object.hasOwn(entry, "scopeKindColumn"),
    false,
    "no scope kind binding: a reservation belongs to the organisation, not to a launch scope",
  );
  assert.equal(
    Object.hasOwn(entry, "scopeIdColumn"),
    false,
    "no scope id binding: a run launched with no scope reads and takes the same list",
  );
});

test("the table declares no scope column and no index over one", () => {
  const entry = table();
  const names = entry.columns.map((c) => c && c.name);
  for (const name of SCOPE_COLUMNS) {
    assert.ok(!names.includes(name), `the table declares no column "${name}"`);
  }
  const indexes = Array.isArray(entry.indexes) ? entry.indexes : [];
  for (const index of indexes) {
    for (const column of index.columns) {
      assert.ok(!SCOPE_COLUMNS.includes(column), `index "${index.name}" names no scope column`);
    }
  }
});

test("the run binding is admitted by the host's own rule, refusal by refusal", () => {
  const entry = table();
  assert.equal(boundColumnIssue(entry, "runColumn", new Map()), null);
  const run = entry.columns.find((c) => c && c.name === "run_id");
  assert.equal(run.type, "text", "the run column is text");
  assert.equal(run.notNull, true, "the run column is notNull — a nullable run is no run");

  // The same cases the host's parser states. Without them the check above could
  // pass against a rule this pack invented.
  const columns = [
    { name: "org_id", type: "text", notNull: true },
    { name: "run_id", type: "text", notNull: true },
    { name: "loose_id", type: "text" },
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
    boundColumnIssue({ ...base, runColumn: "loose_id" }, "runColumn", new Map()),
    /must be declared/,
  );
});

test("the unique reservation rule arbitrates the race across the organisation", () => {
  const entry = table();
  const indexes = Array.isArray(entry.indexes) ? entry.indexes : [];
  const unique = indexes.find((i) => i && i.unique === true);
  assert.ok(unique, "the table keeps its unique reservation index");
  assert.deepEqual(
    unique.columns,
    ["org_id", "idea_artifact_id", "state"],
    "one live row per idea in the organisation — of two runs offering one idea only one takes it",
  );
  assert.deepEqual(
    indexes.map((i) => i.name),
    ["idea_drafts_one_live", "idea_drafts_by_run"],
    "the reservation index and the by-run index, and no other",
  );
  for (const index of indexes) {
    for (const column of index.columns) {
      assert.ok(
        entry.columns.some((c) => c && c.name === column),
        `index "${index.name}" names the declared column "${column}"`,
      );
    }
  }
});
