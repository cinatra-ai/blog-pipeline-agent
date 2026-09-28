"use client";

import { createElement, Fragment, useState } from "react";

// The idea step's own renderer (cinatra#3035). The one field-renderer binding
// this pack declares names this module as its `component.entry`, so the runtime
// mounts it for the stored-ideas gate and hands it the binding's declared params.
//
// PAYLOAD CONTRACT. The gate is an input-message step whose one string output
// (`selectedIdeaJson`) becomes the resume text (`userResponse`); a pick is
// committed as JSON into BOTH keys. NOTHING IS PICKED FOR ANYONE: the list starts
// with no selection and commits only what a person actually chooses, and what it
// commits is the REFERENCE the offer named, never a title.
//
// The module is plain `.ts` written with `createElement`, and it imports nothing
// but `react`, so the pack's own test runner loads it as it is.

/** The props the runtime hands a field renderer (its props contract version 1). */
export type IdeaSelectionProps = {
  value?: unknown;
  onChange: (next: unknown) => unknown;
  disabled?: boolean;
  mode?: "edit" | "view";
  bindingParams?: Readonly<Record<string, unknown>>;
};

/** What the step says when it has no list to offer, the pipeline declared no
 *  message and the offer named no reason of its own. */
const NOTHING_TO_PICK_READING =
  "No blog idea is on offer on this step, so there is nothing to pick here.";

const WAITING_WORDS = "Awaiting your pick";

/** The product radio item's classes, and those of its indicator icon. */
const RADIO_ITEM_CLASSES =
  "aspect-square size-4 shrink-0 rounded-full border border-input bg-surface-muted text-primary shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input-fill/30 dark:aria-invalid:ring-destructive/40";
const RADIO_INDICATOR_CLASSES =
  "absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-primary";

/** One entry of an offer, as it arrives on the render input. */
type OfferedChoice = {
  artifactId?: unknown;
  representationRevisionId?: unknown;
  title?: unknown;
  text?: unknown;
  [extraKey: string]: unknown;
};

/** The pair a pick is committed as. */
type ChoiceReference = { artifactId: string; representationRevisionId: string };

/** The reference an entry names, or null when it names none. */
function choiceReference(choice: OfferedChoice): ChoiceReference | null {
  const artifactId = choice.artifactId;
  const representationRevisionId = choice.representationRevisionId;
  if (typeof artifactId !== "string" || artifactId.length === 0) return null;
  if (typeof representationRevisionId !== "string" || representationRevisionId.length === 0) {
    return null;
  }
  return { artifactId, representationRevisionId };
}

/** Every entry of an offer that can actually be committed. */
function offerableChoices(value: unknown): OfferedChoice[] {
  if (!Array.isArray(value)) return [];
  return (value as OfferedChoice[]).filter((choice) => choiceReference(choice) !== null);
}

/** The entry's declared title, else a positional one so a row is never nameless. */
function choiceTitle(choice: OfferedChoice, index: number, fallbackNoun = "Item"): string {
  return typeof choice.title === "string" && choice.title.trim().length > 0
    ? choice.title
    : `${fallbackNoun} ${index + 1}`;
}

/** The entry's own words BELOW its title: an offered piece of text is one block
 *  whose first line is the title, so the body is the rest of it. */
function choiceBody(choice: OfferedChoice): string {
  const text = typeof choice.text === "string" ? choice.text : "";
  return text.split(/\r?\n/).slice(1).join("\n").trim();
}

/** The run-ending sentence an offer carries instead of entries, when it has one. */
function statedReason(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** A declared param that is a string and not blank, else null. */
function declaredWords(params: IdeaSelectionProps["bindingParams"], key: string): string | null {
  const words = params?.[key];
  return typeof words === "string" && words.trim() !== "" ? words : null;
}

/**
 * The idea-selection field renderer. Reads the offered ideas from
 * `props.value.ideas` and the run-ending sentence, when there is one, from
 * `props.value.reason`. THE STEP IS A LIST, NEVER A FIELD: with no offered ideas
 * it draws one sentence and no row, no radio and no button.
 */
export default function BlogIdeaSelectionRenderer(props: IdeaSelectionProps) {
  const value = (props.value ?? {}) as {
    ideas?: unknown;
    summary?: unknown;
    reason?: unknown;
    [extraKey: string]: unknown;
  };
  const offered = offerableChoices(value.ideas);
  const reason = statedReason(value.reason);
  // The step's header, on every reading: ONE row with the question the pipeline
  // declared for this step (a blank or absent one draws no element) and, while
  // the run waits, the pill. A read-only replay (`mode="view"`) never waits.
  const declaredQuestion = declaredWords(props.bindingParams, "question");
  const waiting = props.mode !== "view";
  const header =
    declaredQuestion !== null || waiting
      ? createElement(
          "div",
          {
            className: "flex flex-wrap items-center gap-2.5",
            "data-testid": "idea-selection-gate-header",
          },
          declaredQuestion !== null
            ? createElement(
                "span",
                {
                  className: "font-sans text-sm font-bold text-foreground",
                  "data-testid": "idea-selection-gate-question",
                },
                declaredQuestion,
              )
            : null,
          waiting
            ? createElement(
                "span",
                {
                  "data-testid": "idea-selection-gate-waiting",
                  className:
                    "inline-flex items-center gap-1.5 rounded-full border border-brand-mustard/40 bg-brand-mustard/15 px-2.5 py-0.5 text-xs font-semibold text-mustard-ink",
                },
                createElement("span", {
                  className: "size-[7px] rounded-full bg-brand-mustard",
                  "aria-hidden": "true",
                }),
                WAITING_WORDS,
              )
            : null,
        )
      : null;
  if (offered.length === 0) {
    // No rows, no Continue, no field: the empty-state message the pipeline
    // declared, as it wrote it; else the offer's own reason; else the floor.
    return createElement(
      Fragment,
      null,
      header,
      createElement(
        "p",
        { role: "status", className: "text-sm text-foreground" },
        declaredWords(props.bindingParams, "emptyStateMessage") ?? reason ?? NOTHING_TO_PICK_READING,
      ),
    );
  }
  const summary =
    typeof value.summary === "string" && value.summary.trim().length > 0
      ? value.summary
      : undefined;
  return createElement(
    Fragment,
    null,
    header,
    summary ? createElement("p", { className: "text-sm text-muted-foreground mb-2" }, summary) : null,
    createElement(IdeaChooser, {
      ideas: offered,
      onChange: props.onChange,
      disabled: props.disabled,
    }),
  );
}

/**
 * Radio-per-idea chooser. Commits `JSON.stringify({artifactId,
 * representationRevisionId})` into { selectedIdeaJson, userResponse } — and only
 * ever in response to a person choosing.
 */
function IdeaChooser({
  ideas,
  onChange,
  disabled,
}: {
  ideas: OfferedChoice[];
  onChange: (next: unknown) => unknown;
  disabled?: boolean;
}) {
  // No index: nothing is chosen until someone chooses.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const choose = (idx: number) => {
    if (disabled || idx === selectedIndex) return;
    setSelectedIndex(idx);
    const reference = choiceReference(ideas[idx]);
    if (!reference) return;
    const json = JSON.stringify(reference);
    void onChange({ selectedIdeaJson: json, userResponse: json });
  };
  return createElement(
    "div",
    { className: "flex flex-col gap-2" },
    createElement("p", { className: "text-sm text-muted-foreground" }, "Select one blog idea to draft."),
    createElement(
      "div",
      {
        role: "radiogroup",
        "aria-label": "Select one blog idea to draft",
        className: "flex flex-col gap-2",
      },
      ideas.map((idea, idx) => {
        const selected = idx === selectedIndex;
        const sub = choiceBody(idea);
        return createElement(
          "label",
          {
            key: idx,
            className: `flex cursor-pointer items-start gap-2 rounded-control border p-3 text-sm ${
              selected ? "border-primary bg-surface-muted" : "border-line"
            } ${disabled ? "pointer-events-none opacity-60" : ""}`,
          },
          createElement(
            "button",
            {
              type: "button",
              role: "radio",
              "aria-checked": selected ? "true" : "false",
              "data-state": selected ? "checked" : "unchecked",
              disabled,
              className: `${RADIO_ITEM_CLASSES} mt-1 relative`,
              onClick: () => choose(idx),
            },
            selected
              ? createElement(
                  "svg",
                  { viewBox: "0 0 24 24", "aria-hidden": "true", className: RADIO_INDICATOR_CLASSES },
                  createElement("circle", { cx: 12, cy: 12, r: 10 }),
                )
              : null,
          ),
          createElement(
            "span",
            { className: "flex flex-col gap-0.5" },
            createElement("span", { className: "font-medium" }, choiceTitle(idea, idx, "Idea")),
            sub
              ? createElement("span", { className: "text-muted-foreground whitespace-pre-line" }, sub)
              : null,
          ),
        );
      }),
    ),
  );
}
