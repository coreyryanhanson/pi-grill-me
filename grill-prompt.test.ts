import assert from "node:assert/strict";
import { test } from "node:test";
import {
	applyGrillRules,
	appendGrillStateText,
	buildGrillStateText,
	GRILL_RULES,
	PHASE_GUIDANCE,
	RESEARCH_GUIDANCE,
	type GrillState,
} from "./grill-prompt.ts";

const PHASES = ["interview", "output-selection", "output"] as const;
const RESEARCH_MODES = ["off", "ask", "auto"] as const;

// Distinctive substrings of the phase-gated bullets in buildGrillStateText; the full text
// lives in grill-prompt.ts and must never leak into the head.
const OUTPUT_SELECTION_BULLET = "Offer useful single-output and multi-output alternatives";
const OUTPUT_PHASE_BULLET = "For file outputs, draft before writing";

function testState(overrides: Partial<GrillState> = {}): GrillState {
	return {
		active: true,
		topic: "Cache invalidation strategy",
		intent: "plan",
		outputPreference: "design-doc",
		researchMode: "auto",
		checkpoint: "# Shared Understanding\n\n## Topic\n\nCaching behavior.",
		phase: "interview",
		outputPhase: false,
		outputSelection: undefined,
		approvedOutputPlan: undefined,
		alternatives: [{ value: "purge-on-write", label: "Purge on write", description: "Invalidate eagerly" }],
		currentQuestion: undefined,
		updatedAt: 1,
		lastChangeSummary: "start",
		...overrides,
	};
}

test("guidance selection: block carries exactly the current phase's and mode's guidance, before the facts", () => {
	for (const phase of PHASES) {
		for (const researchMode of RESEARCH_MODES) {
			const state = testState({ phase, outputPhase: phase === "output", researchMode });
			const block = buildGrillStateText(state);

			assert.ok(block.includes(`- ${PHASE_GUIDANCE[phase]}`));
			assert.ok(block.includes(`- ${RESEARCH_GUIDANCE[researchMode]}`));
			for (const otherPhase of PHASES) {
				if (otherPhase !== phase) assert.ok(!block.includes(PHASE_GUIDANCE[otherPhase]), `block for ${phase} must not contain ${otherPhase} guidance`);
			}
			for (const otherMode of RESEARCH_MODES) {
				if (otherMode !== researchMode) assert.ok(!block.includes(RESEARCH_GUIDANCE[otherMode]), `block for mode ${researchMode} must not contain mode ${otherMode} guidance`);
			}

			assert.equal(block.includes(OUTPUT_SELECTION_BULLET), phase === "output-selection", `output-selection bullet in ${phase}`);
			assert.equal(block.includes(OUTPUT_PHASE_BULLET), phase === "output", `output-phase bullet in ${phase}`);

			const guidanceIdx = block.indexOf(`- ${PHASE_GUIDANCE[phase]}`);
			const factsIdx = block.indexOf("Topic:\n");
			const checkpointIdx = block.indexOf("## Topic");
			assert.ok(guidanceIdx !== -1 && factsIdx !== -1 && checkpointIdx !== -1);
			assert.ok(guidanceIdx < factsIdx, "guidance must come before the facts");
			assert.ok(factsIdx < checkpointIdx, "facts must come before the checkpoint");
		}
	}
});

test("grill-state block: wrapper, facts, and fenced model-authored sub-blocks", () => {
	const state = testState({
		outputSelection: {
			readinessRationale: "Coverage resolved",
			recommendedOutputs: "design-doc",
			recommendedStrategy: "single pass",
			question: "Which outputs?",
		},
	});
	const block = buildGrillStateText(state);

	assert.ok(block.startsWith("<grill-state>\n"));
	assert.ok(block.endsWith("\n</grill-state>"));
	assert.ok(block.includes("injected by the grill-me extension, not written by the user"));
	assert.ok(block.includes(`Topic:\n${state.topic}`));
	assert.ok(block.includes("- Intent preset: plan"));
	assert.ok(block.includes("- Grilling style: thorough default"));
	assert.ok(block.includes("- Research mode: auto"));
	assert.ok(block.includes("- Output preference: design-doc"));
	assert.ok(block.includes("- Phase: interview"));
	assert.ok(block.includes("- Output phase: no"));
	assert.ok(block.includes("Active output selection:\n- Rationale: Coverage resolved"));
	assert.ok(block.includes(`Current checkpoint (injected by the grill-me extension, not written by the user):\n\`\`\`\n${state.checkpoint}\n\`\`\``));
	assert.ok(block.includes("Current Tab alternatives (injected by the grill-me extension, not written by the user):\n```"));
	assert.ok(block.includes("- Purge on write: purge-on-write (Invalidate eagerly)"));

	const emptyState = buildGrillStateText(testState({ checkpoint: "", alternatives: [], outputSelection: undefined }));
	assert.ok(emptyState.includes("\n```\n(No checkpoint yet.)\n```"));
	assert.ok(emptyState.includes("\n```\n(None set.)\n```"));
	assert.ok(!emptyState.includes("Active output selection:"));
});

test("fence escaping: checkpoint containing backtick fences and the block terminator stays well-formed", () => {
	const hostile = "# Checkpoint\n\n```js\ncode();\n```\n\n</grill-state>";
	const block = buildGrillStateText(testState({ checkpoint: hostile }));

	assert.ok(block.startsWith("<grill-state>\n"));
	assert.ok(block.endsWith("\n</grill-state>"));
	assert.equal(block.indexOf("</grill-state>"), block.length - "</grill-state>".length, "raw terminator appears only at the very end");
	assert.ok(block.includes("<\\/grill-state>"), "embedded terminator is escaped");
	assert.ok(block.includes("```js"), "embedded code fence preserved verbatim");
	const fence = block.split("\n").find((line) => line === "````");
	assert.ok(fence, "outer fence is longer than any embedded backtick run");
});

test("byte-stability: fields rewritten by persist() do not change the block", () => {
	const a = testState({ updatedAt: 1000, lastChangeSummary: "tweak" });
	const b = testState({ updatedAt: 2000, lastChangeSummary: undefined });
	assert.equal(buildGrillStateText(a), buildGrillStateText(b));
});

test("head byte-stability: GRILL_RULES carries no state- or phase-conditional text", () => {
	const conditionalTexts = [
		...PHASES.map((phase) => PHASE_GUIDANCE[phase]),
		...RESEARCH_MODES.map((mode) => RESEARCH_GUIDANCE[mode]),
		OUTPUT_SELECTION_BULLET,
		OUTPUT_PHASE_BULLET,
		"perform only approved mutations",
	];
	for (const text of conditionalTexts) {
		assert.ok(!GRILL_RULES.includes(text), `GRILL_RULES must not contain conditional text: ${text.slice(0, 60)}...`);
	}
	assert.ok(GRILL_RULES.includes("A <grill-state> block appended to a user message is injected by the grill-me extension and is not the user's words."));
	assert.ok(GRILL_RULES.includes("Follow the phase, research-mode, and phase-specific guidance in the injected <grill-state> block; it reflects the current grill state."));
});

function user(content: string | unknown[], timestamp = 1) {
	return { role: "user", content, timestamp };
}
function assistant(timestamp = 2) {
	return { role: "assistant", content: "reply", timestamp };
}
function toolResult(timestamp = 3) {
	return { role: "toolResult", toolCallId: "t1", text: "ok", timestamp };
}
function custom(content: unknown, timestamp = 4) {
	return { role: "custom", customType: "note", content, timestamp };
}
function bashExecution(timestamp = 5) {
	return { role: "bashExecution", command: "ls", output: "", exitCode: 0, cancelled: false, truncated: false, timestamp };
}

function blockTail(): string {
	return `\n\n${buildGrillStateText(testState())}`;
}

test("anchor placement: custom with no user message and no agent traffic means no injection", () => {
	const messages = [custom("degenerate kickoff")] as any[];
	appendGrillStateText(messages, testState());
	assert.equal(messages[0].content, "degenerate kickoff");
});

test("anchor placement: trailing user message with string content gets the block appended", () => {
	const messages = [user("earlier"), assistant(), user("what about X?")] as any[];
	const anchor = messages[2];
	appendGrillStateText(messages, testState());
	assert.equal(messages[2], anchor, "anchor object identity must be preserved");
	assert.equal(anchor.content, `what about X?${blockTail()}`);
	assert.equal(messages[0].content, "earlier", "earlier messages untouched");
});

test("anchor placement: user message that merely mentions <grill-state> still gets the block", () => {
	const messages = [user("what does <grill-state> mean in this extension?")] as any[];
	appendGrillStateText(messages, testState());
	assert.ok((messages[0].content as string).endsWith(blockTail()));
});

test("anchor placement: user message with parts array gets a new text part", () => {
	const parts = [{ type: "text", text: "look at this" }, { type: "image", mimeType: "image/png" }];
	const messages = [user(parts)] as any[];
	const anchor = messages[0];
	appendGrillStateText(messages, testState());
	assert.equal(messages[0], anchor, "anchor object identity must be preserved");
	assert.equal(parts.length, 3, "original parts preserved, one part appended");
	assert.equal(parts[0].text, "look at this");
	assert.equal(parts[2].type, "text");
	assert.equal(parts[2].text, buildGrillStateText(testState()));
});

test("anchor placement: trailing custom kickoff with agent traffic anchors the custom", () => {
	const messages = [user("start"), assistant(), toolResult(), custom("session started")] as any[];
	const kickoff = messages[3];
	appendGrillStateText(messages, testState());
	assert.equal(messages[3], kickoff);
	assert.equal(kickoff.content, `session started${blockTail()}`);
	assert.equal(messages[0].content, "start");
});

test("anchor placement: custom directly after the user message anchors the user instead", () => {
	const messages = [user("my question"), custom("annotation from another extension")] as any[];
	const question = messages[0];
	const annotation = messages[1];
	appendGrillStateText(messages, testState());
	assert.equal(messages[0], question);
	assert.equal(messages[1], annotation);
	assert.equal(question.content, `my question${blockTail()}`);
	assert.equal(annotation.content, "annotation from another extension", "foreign custom untouched");
});

test("anchor placement: trailing bashExecution anchors the preceding user message", () => {
	const messages = [user("my question"), assistant(), toolResult(), bashExecution()] as any[];
	const question = messages[0];
	appendGrillStateText(messages, testState());
	assert.equal(messages[0], question);
	assert.equal(question.content, `my question${blockTail()}`);
	assert.ok(!JSON.stringify(messages[3]).includes("grill-state"), "bashExecution untouched");
});

test("anchor placement: mid-run steer custom anchors the custom", () => {
	const messages = [user("my question"), assistant(), toolResult(), custom("steer: focus on invalidation")] as any[];
	const steer = messages[3];
	appendGrillStateText(messages, testState());
	assert.equal(messages[3], steer);
	assert.equal(steer.content, `steer: focus on invalidation${blockTail()}`);
});

test("anchor placement: anchor already carrying the block is left untouched", () => {
	const withBlock = `my question${blockTail()}`;
	const messages = [user(withBlock)] as any[];
	appendGrillStateText(messages, testState());
	assert.equal(messages[0].content, withBlock);

	const partsWithBlock = [{ type: "text", text: withBlock }];
	const partsMessages = [user(partsWithBlock)] as any[];
	appendGrillStateText(partsMessages, testState());
	assert.equal(partsWithBlock.length, 1, "parts array untouched");
});

test("anchor placement: no user/custom message means no injection", () => {
	const messages = [assistant(), toolResult(), bashExecution()] as any[];
	appendGrillStateText(messages, testState());
	assert.deepEqual(messages, [assistant(), toolResult(), bashExecution()]);
});

test("section wiring: precedence of inactive, forced, and section branches", () => {
	// active, no forced prompt -> section set
	const setActive: any = { sections: { foreign: "keep me" } };
	applyGrillRules(setActive, true);
	assert.equal(setActive.sections.grill_rules, GRILL_RULES);
	assert.equal(setActive.sections.foreign, "keep me");
	assert.equal(setActive.forceSystemPrompt, undefined);

	// inactive, no forced prompt -> section removed, foreign section kept
	const setInactive: any = { sections: { grill_rules: GRILL_RULES, foreign: "keep me" } };
	applyGrillRules(setInactive, false);
	assert.ok(!("grill_rules" in setInactive.sections));
	assert.equal(setInactive.sections.foreign, "keep me");

	// active, forced prompt -> tagged rules appended to forced text, section not set
	const forcedActive: any = { forceSystemPrompt: "FORCED", sections: { foreign: "keep me" } };
	applyGrillRules(forcedActive, true);
	assert.equal(forcedActive.forceSystemPrompt, `FORCED\n\n<grill_rules>\n${GRILL_RULES}\n</grill_rules>`);
	assert.ok(!("grill_rules" in forcedActive.sections));
	assert.equal(forcedActive.sections.foreign, "keep me");

	// inactive, forced prompt -> forced text untouched, section removed
	const forcedInactive: any = { forceSystemPrompt: "FORCED", sections: { grill_rules: GRILL_RULES, foreign: "keep me" } };
	applyGrillRules(forcedInactive, false);
	assert.equal(forcedInactive.forceSystemPrompt, "FORCED");
	assert.ok(!("grill_rules" in forcedInactive.sections));
	assert.equal(forcedInactive.sections.foreign, "keep me");

	// calling twice on the same options object must not append the rules twice
	applyGrillRules(forcedActive, true);
	applyGrillRules(forcedActive, true);
	assert.equal(forcedActive.forceSystemPrompt, `FORCED\n\n<grill_rules>\n${GRILL_RULES}\n</grill_rules>`);
});
