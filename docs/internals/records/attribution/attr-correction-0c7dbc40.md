# Attribution-record correction — 0c7dbc40 (idea step pick)

Forward correction (the Truthful Attribution protocol) for the verification record
of squash commit `0c7dbc40ccec17ad14269baaf4d51a94d721c729`
("Hold the idea step's Continue until a pick, and answer a list with nothing to pick with a no-pick value (#80)").

## What was wrong
The squash landed with a gate-suite verification record, but its `Assisted-by`
record names only the agent that built the change.
The findings of independent read-only reviews by two other agents drove the
changes of four of its five commits:
`61865900b67c0ce907a7785d02fceb7d37c57f13` and
`aaf5141575743b79561a1e2ab113ba9b1a947f1e` answer the findings of reviews by one
of these agents, and `26ee502022de17a827dfa0c3e166540787886b49` and
`33a4931b81fae13187ee75944142e950b5fe3b02` answer the findings of reviews by the other.
Both reviewing agents therefore materially changed the diff and belong in the record.

## The corrected truthful record for 0c7dbc40

The corrected record names the building agent and the two reviewing agents.
The change itself is untouched. The commit that adds this file carries the
three corrected Assisted-by lines in its trailer block and `Correction-for: 0c7dbc40ccec17ad14269baaf4d51a94d721c729`.
