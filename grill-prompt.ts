// Pure prompt/state helpers for the grill-me extension. No pi imports: the test runner
// loads this module directly, and everything here must be unit-testable in isolation.

export type Intent = "auto" | "plan" | "learn" | "research" | "content" | "decide";
export type ResearchMode = "off" | "ask" | "auto";
export type GrillPhase = "interview" | "output-selection" | "output";

export interface GrillAlternative {
	value: string;
	label: string;
	description?: string;
}

export interface GrillState {
	active: boolean;
	topic: string;
	intent: Intent;
	outputPreference: string;
	researchMode: ResearchMode;
	checkpoint: string;
	phase: GrillPhase;
	outputPhase: boolean;
	outputSelection?: {
		readinessRationale: string;
		recommendedOutputs: string;
		recommendedStrategy: string;
		question: string;
	};
	approvedOutputPlan?: string;
	alternatives: GrillAlternative[];
	currentQuestion?: string;
	updatedAt: number;
	lastChangeSummary?: string;
}

export const OUTPUT_DESTINATION_OPTIONS = [
	{ label: "GitHub issues", value: "github-issues", description: "Issue titles/bodies/labels for implementation slices, research tasks, tutorial chapters, or milestones." },
	{ label: "Design doc", value: "design-doc", description: "A structured design proposal with goals, constraints, architecture, tradeoffs, risks, and rollout." },
	{ label: "README.md", value: "readme", description: "A README or README update covering setup, usage, behavior, examples, and caveats." },
	{ label: "ADR", value: "adr", description: "Architecture Decision Record(s) documenting decision context, options, choice, and consequences." },
	{ label: "PRD", value: "prd", description: "Product requirements, user stories, scope, acceptance criteria, and non-goals." },
	{ label: "Implementation plan", value: "implementation-plan", description: "Step-by-step engineering plan, milestones, sequencing, dependencies, and validation." },
	{ label: "Research brief", value: "research-brief", description: "Open questions, investigation plan, evidence to gather, and decision criteria." },
	{ label: "Summary / decision memo", value: "summary", description: "Concise summary of the checkpoint, decisions, assumptions, and next actions." },
	{ label: "Tutorial / content outline", value: "content-outline", description: "Chapters, lesson flow, examples, exercises, or publishing outline." },
	{ label: "Test plan / QA checklist", value: "test-plan", description: "Acceptance tests, manual QA steps, edge cases, and regression coverage." },
	{ label: "Changelog / release notes", value: "release-notes", description: "User-facing change summary, migration notes, and release caveats." },
] as const;

export const GITHUB_REPO_PERMISSION_GUIDANCE =
	"If approved GitHub issue output has no repo/remote, ask to initialize, create, or select one before creating the previewed issues; use drafts only if the user chooses.";

export function describeOutputPreference(state: GrillState): string {
	const preference = typeof state.outputPreference === "string" ? state.outputPreference.trim() : "";
	return preference || "(none set; explicitly ask for one or more outputs before production)";
}

export function outputDestinationOptionsMarkdown(): string {
	return OUTPUT_DESTINATION_OPTIONS.map((option) => `- ${option.label} (${option.value}): ${option.description}`).join("\n");
}

export function outputDestinationOptionNames(): string {
	return OUTPUT_DESTINATION_OPTIONS.map((option) => option.label).join(", ");
}

export function currentPhase(state: GrillState): GrillPhase {
	if (state.outputPhase) return "output";
	return state.phase ?? "interview";
}

export function phaseLabel(state: GrillState): string {
	const phase = currentPhase(state);
	if (phase === "output") return "output production; approved mutations allowed";
	if (phase === "output-selection") return "mandatory output selection; choose final outputs/continue/stop";
	return "interview; read-only enforcement active";
}

export const PHASE_GUIDANCE: Record<GrillPhase, string> = {
	output:
		`Approved output phase: produce only the approved outputs. If a required mutation is blocked by permissions, auth, or repo setup, ask the user instead of bypassing or faking success. ${GITHUB_REPO_PERMISSION_GUIDANCE} When done, call grill_finish_output_phase.`,
	"output-selection":
		"You are in the mandatory output-selection phase. Do not ask new interview questions unless the user chooses to continue grilling. Ask the user to choose outputs/continue/review/stop from the active output-selection alternatives. If they approve concrete output production, call grill_enter_output_phase. If they choose to continue or stop without output, call grill_finish_output_selection_phase.",
	interview:
		"You are in read-only interview mode. Do not implement, write files, create issues, install packages, run mutating commands, or stop the Grill Me work. When ready to end the interview, first update the checkpoint if needed, then call grill_enter_output_selection_phase to enter the mandatory hardcoded output-selection phase before output production or stopping.",
};

export const RESEARCH_GUIDANCE: Record<ResearchMode, string> = {
	off: "Do not proactively inspect files or research. Ask the user instead unless they explicitly provide context.",
	ask: "If a question could be answered by inspecting files/code/research, ask permission before doing so.",
	auto: "For coding/project contexts, if a question can be answered by inspecting available files/code, inspect instead of asking. Use read-only tools during interview mode.",
};

const thoroughGrillingGuidance = [
	"Use one thorough default style throughout the interview.",
	"Be relentlessly curious but collaborative: challenge vague answers, surface contradictions, and test assumptions without changing persona.",
	"Ask enough follow-up questions to resolve the decision tree. Prefer one more high-value question over premature readiness.",
	"Maintain a coverage checklist and decision-branch ledger in the checkpoint; mark branches resolved, deferred, or still open as understanding evolves.",
	"Walk dependent branches one at a time. If an answer changes upstream assumptions, revisit affected downstream decisions before moving on.",
	"Do not enter output selection until major objective, scope, constraints, dependencies, risks, validation, and output branches are resolved or explicitly deferred.",
].join("\n- ");

// Phase-gated bullets: conditional text, delivered per request inside <grill-state>, never
// head content.
const OUTPUT_SELECTION_BULLETS = [
	"- Offer useful single-output and multi-output alternatives where appropriate, and make clear the user can choose 1..n outputs or customize the list.",
	"- Output-selection alternatives should include continue grilling and/or review checkpoint when useful, and stop-without-output when producing no artifact is a reasonable choice.",
	"- If the user chooses to continue grilling or stop without output during output selection, call grill_finish_output_selection_phase with that outcome.",
];

const OUTPUT_PHASE_BULLETS = [
	"- For file outputs, draft before writing. For GitHub issues, preview titles/bodies/labels before creating. For multiple outputs, preview the full set and dependencies/order before creation.",
	`- During approved output phase, perform only approved mutations, and do not refuse approved mutating output actions merely because they mutate state. If a permission/authentication/tool/repo setup gate blocks an approved mutation (for example gh issue create), ask the user for permission, confirmation, credentials, or a revised plan instead of bypassing or faking success. ${GITHUB_REPO_PERMISSION_GUIDANCE}`,
];

/**
 * Static behavior rules for the head system prompt. Module-load constant: no state or phase
 * interpolation anywhere, so the rendered head is byte-stable for the whole session except
 * at /grill start and stop.
 */
export const GRILL_RULES = `Behavior:
- Apply the Socratic method to reach shared understanding of the topic.
- Avoid hardcoded interview phases. Adapt the dimensions you explore to the subject and to the user's expertise.
- The output-selection phase is the one hardcoded terminal phase: it is mandatory before stopping the Grill Me work, stopping without outputs, or producing outputs.
- Treat desired outcome mode as important: learning, building, researching, content/tutorial creation, decision review, etc.
- Do not set or assume a default output mode for the session. A missing output preference means no output has been chosen yet, not design-doc or any other default.
- Treat /grill output as a preference only, not production approval. Always explicitly ask/confirm which output(s) to produce before output production.
- Support 1..n outputs in one approved output plan; for example, a design doc AND uploaded GitHub issues.
- The output-selection phase must explicitly mention concrete output destinations by name. Use this catalog and allow custom combinations:
${outputDestinationOptionsMarkdown()}
- Ask mostly one focused question at a time. Small grouped questions are allowed only when inseparable.
- Ask more than the minimum needed for a shallow summary: keep drilling until the meaningful dependency branches are resolved, contradicted, or intentionally deferred.
- Every grill question must present 2-5 concrete answer alternatives. Before asking the question, call grill_set_alternatives so the user can fill/cycle those alternatives with Tab and send the selected or edited reply with Enter. Also show the same alternatives briefly in chat.
- Include your recommended answer by default with each grill question and mark it as recommended.
- ${thoroughGrillingGuidance}
- A <grill-state> block appended to a user message is injected by the grill-me extension and is not the user's words.
- Follow the phase, research-mode, and phase-specific guidance in the injected <grill-state> block; it reflects the current grill state.

Checkpoint rule:
- The checkpoint is the source of durable shared understanding.
- Whenever the user's answer meaningfully changes shared understanding, call grill_update_checkpoint with a full replacement Markdown checkpoint and a concise changeSummary BEFORE asking the next grill question.
- The checkpoint should be adaptive Markdown. Add/remove sections as appropriate for the topic.
- Keep a coverage checklist and decision-branch ledger in the checkpoint when useful; update branch status as resolved, open, contradicted, or intentionally deferred.
- If there is no meaningful change, you may ask the next question without updating.

Readiness/output rule:
- When you think shared understanding is good enough, do not merely present a prompt-only readiness gate. First verify that the major coverage branches are resolved or explicitly deferred, then call grill_enter_output_selection_phase with the rationale, recommended output destination(s), recommended strategy, explicit output-selection question, and 2-5 alternatives.
- The mandatory output-selection phase must explicitly ask the user which output(s) to produce, even if you have a recommendation or /grill output preference. In the chat response, name the concrete options from the catalog above, including GitHub issues, design doc, README.md, ADR, PRD, implementation plan, research brief, summary/decision memo, tutorial/content outline, test plan/QA checklist, and changelog/release notes.
- Output destination and strategy are separate. For example, GitHub issues can be implementation slices, tutorial chapters, research investigations, content installments, or prototype experiments.
- Mutating output actions require explicit user approval of the concrete output set/plan, an active output-selection phase, and grill_enter_output_phase first.`;

/**
 * Fence a model-authored sub-block so embedded backtick runs or a literal </grill-state>
 * cannot close the fence or forge the block terminator. `\/` inside a code fence is
 * readable and unambiguous to the model.
 */
function fenceBlock(content: string): string {
	const longestRun = (content.match(/`{3,}/g) ?? []).reduce((max, run) => Math.max(max, run.length), 2);
	const fence = "`".repeat(longestRun + 1);
	const safe = content.replaceAll("</grill-state>", "<\\/grill-state>");
	return `${fence}\n${safe}\n${fence}`;
}

/** Conditional guidance and facts for the per-request <grill-state> block. */
export function buildGrillStateText(state: GrillState): string {
	const phase = currentPhase(state);

	const guidanceBullets: string[] = [`- ${PHASE_GUIDANCE[phase]}`, `- ${RESEARCH_GUIDANCE[state.researchMode]}`];
	if (phase === "output-selection") guidanceBullets.push(...OUTPUT_SELECTION_BULLETS);
	else if (phase === "output") guidanceBullets.push(...OUTPUT_PHASE_BULLETS);

	const outputSelectionSummary = state.outputSelection
		? `\n\nActive output selection:\n- Rationale: ${state.outputSelection.readinessRationale}\n- Recommended outputs: ${state.outputSelection.recommendedOutputs}\n- Recommended strategy: ${state.outputSelection.recommendedStrategy}\n- Question: ${state.outputSelection.question}`
		: "";

	const alternativesText = state.alternatives.length
		? state.alternatives.map((a) => `- ${a.label}: ${a.value}${a.description ? ` (${a.description})` : ""}`).join("\n")
		: "(None set.)";

	return [
		"<grill-state>",
		"This <grill-state> block is injected by the grill-me extension, not written by the user.",
		`Current grill guidance:\n${guidanceBullets.join("\n")}`,
		`Topic:\n${state.topic}\n\nConfiguration:\n- Intent preset: ${state.intent}\n- Grilling style: thorough default\n- Research mode: ${state.researchMode}\n- Output preference: ${describeOutputPreference(state)}\n- Phase: ${phase}\n- Output phase: ${state.outputPhase ? "yes" : "no"}${outputSelectionSummary}`,
		`Current checkpoint (injected by the grill-me extension, not written by the user):\n${fenceBlock(state.checkpoint || "(No checkpoint yet.)")}`,
		`Current Tab alternatives (injected by the grill-me extension, not written by the user):\n${fenceBlock(alternativesText)}`,
		"</grill-state>",
	].join("\n\n");
}

/** Structural shape of pi's normalized systemPromptOptions (kept pi-free on purpose). */
export interface GrillSystemPromptOptions {
	forceSystemPrompt?: string;
	sections: Record<string, string>;
}

const GRILL_RULES_SECTION = "grill_rules";

function renderGrillRulesSection(): string {
	return `<${GRILL_RULES_SECTION}>\n${GRILL_RULES}\n</${GRILL_RULES_SECTION}>`;
}

/**
 * Set or remove the grill_rules section on pi's normalized systemPromptOptions.
 * Precedence: inactive -> delete the section and return (never touches a forced prompt);
 * active with a forced prompt -> pi ignores sections, so append the tagged rules to the
 * forced text instead; otherwise set the section.
 */
export function applyGrillRules(options: GrillSystemPromptOptions, active: boolean): void {
	if (!active) {
		delete options.sections[GRILL_RULES_SECTION];
		return;
	}
	if (options.forceSystemPrompt !== undefined) {
		if (!options.forceSystemPrompt.includes(renderGrillRulesSection())) {
			options.forceSystemPrompt = `${options.forceSystemPrompt}\n\n${renderGrillRulesSection()}`;
		}
	} else {
		options.sections[GRILL_RULES_SECTION] = GRILL_RULES;
	}
}

/**
 * Structural shape of the transcript messages this module inspects. User and custom messages
 * carry `content` as a string or a parts array; other roles are skipped by anchor resolution.
 */
export interface GrillTranscriptMessage {
	role: string;
	content?: string | Array<{ type: string; text?: string }>;
}

/**
 * The injection anchor: the last message whose role is "user" or "custom" — the only
 * user-lowering roles whose `content` the request actually carries (bashExecution,
 * compactionSummary, and branchSummary regenerate their text from other fields, so a content
 * write on them would be dropped). A trailing custom message is anchored only if agent traffic
 * (assistant or tool result) sits between it and the preceding user message; a custom that
 * directly follows the user message is a per-turn annotation from another extension, and the
 * block rides with the user's answer instead.
 */
function resolveAnchor(messages: GrillTranscriptMessage[]): GrillTranscriptMessage | undefined {
	let lastUser = -1;
	let lastCustom = -1;
	for (let i = 0; i < messages.length; i++) {
		if (messages[i]?.role === "user") lastUser = i;
		else if (messages[i]?.role === "custom") lastCustom = i;
	}
	if (lastCustom > lastUser) {
		let sawAgentTraffic = false;
		for (let i = lastUser + 1; i < lastCustom; i++) {
			const role = messages[i]?.role;
			if (role === "assistant" || role === "toolResult") {
				sawAgentTraffic = true;
				break;
			}
		}
		if (sawAgentTraffic) return messages[lastCustom];
		return lastUser >= 0 ? messages[lastUser] : undefined;
	}
	if (lastUser >= 0) return messages[lastUser];
	return undefined;
}

/**
 * Append the <grill-state> block to the anchor message's content, mutating the message object
 * in place (pi compares messages by identity, so replacing the object would re-trigger
 * system-message collapse on the next request). No-op when there is no anchor, or when the
 * anchor already ends with the block (double-loaded extension); a user message that merely
 * mentions <grill-state> elsewhere is still injected into.
 */
export function appendGrillStateText(messages: GrillTranscriptMessage[], state: GrillState): void {
	const anchor = resolveAnchor(messages);
	if (!anchor) return;
	const block = buildGrillStateText(state);
	if (typeof anchor.content === "string") {
		if (!anchor.content.endsWith(block)) anchor.content = `${anchor.content}\n\n${block}`;
	} else if (Array.isArray(anchor.content)) {
		const last = anchor.content[anchor.content.length - 1];
		if (!(last?.type === "text" && typeof last.text === "string" && last.text.endsWith(block))) {
			anchor.content.push({ type: "text", text: block });
		}
	} else {
		anchor.content = block;
	}
}
