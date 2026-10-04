// A teammate's question that a Chief hands on to the person as a card in
// the Chief's own conversation (relay_question). The person answers there,
// the answer comes back to the Chief as an ordinary chat line, and the Chief
// passes it on to the teammate. Nothing about the card grants or runs
// anything: it only shapes the person's reply.

export const RELAY_QUESTION_LIMITS = {
  question: 2_000,
  option: 120,
  maxOptions: 4,
} as const;

/** Who asked, and where, so the card can name them and open their thread. */
export interface RelayRef {
  botId: string;
  name: string;
  threadId?: string;
  threadTitle?: string;
  /** Set when the teammate's own turn stopped on a card: answering this one
   * answers that card directly, by thread and request. */
  requestId?: string;
  /** That card asks to run a tool: the answer is allow or deny. */
  permission?: boolean;
}

export interface RelayQuestionInput {
  bot: string;
  question: string;
  options: string[];
  threadId?: string;
}

export type ParsedRelayQuestionInput =
  | { ok: true; value: RelayQuestionInput }
  | { ok: false; error: string };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, field: string, maximum: number): string | { error: string } {
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const trimmed = value.trim();
  if (!trimmed) return { error: `${field} must not be blank.` };
  if (trimmed.length > maximum) return { error: `${field} must be at most ${maximum} characters.` };
  return trimmed;
}

/** Normalize untrusted model input before it becomes a card. */
export function parseRelayQuestionInput(value: unknown): ParsedRelayQuestionInput {
  if (!record(value)) return { ok: false, error: "relay_question needs an object." };
  const bot = text(value.bot_id, "bot_id", 200);
  if (typeof bot !== "string") return { ok: false, error: bot.error };
  const question = text(value.question, "question", RELAY_QUESTION_LIMITS.question);
  if (typeof question !== "string") return { ok: false, error: question.error };
  const raw = value.options ?? [];
  if (!Array.isArray(raw)) return { ok: false, error: "options must be an array of strings." };
  if (raw.length > RELAY_QUESTION_LIMITS.maxOptions) {
    return { ok: false, error: `options may hold at most ${RELAY_QUESTION_LIMITS.maxOptions} items.` };
  }
  const options: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const option = text(raw[index], `options[${index}]`, RELAY_QUESTION_LIMITS.option);
    if (typeof option !== "string") return { ok: false, error: option.error };
    if (!options.includes(option)) options.push(option);
  }
  let threadId: string | undefined;
  if (value.thread_id !== undefined) {
    if (typeof value.thread_id !== "string" || !/^[\w-]{1,80}$/.test(value.thread_id)) {
      return { ok: false, error: "thread_id must be a thread id." };
    }
    threadId = value.thread_id;
  }
  return { ok: true, value: { bot, question, options, ...(threadId ? { threadId } : {}) } };
}

/** The chat line the Chief receives when the person answers the card. */
export function relayAnswerText(relay: RelayRef, question: string, answer: string): string {
  return `Antwoord voor ${relay.name} op "${question}": ${answer}`;
}

/** The chat line when the person leaves the decision to the Chief. */
export function relayDelegateText(relay: RelayRef, question: string): string {
  return `Beslis jij over de vraag van ${relay.name} ("${question}") binnen je beslisniveau, en geef het door.`;
}

/** A chat line a relay card sent on the person's behalf. The card already
 * shows the answer, so a Chief's chat leaves the line itself out. */
export function isRelayReplyText(text: string | undefined): boolean {
  return !!text && (text.startsWith("Antwoord voor ") || text.startsWith("Beslis jij over de vraag van "));
}

/** The person's own right hand: a Chief with no team of its own that
 * manages other teams. Only it relays questions and shows the quiet
 * manager view; team Chiefs (the PMs) keep their ordinary chat. */
export function isPersonalChief<T extends { chiefOfStaff?: boolean; section?: string; managedSections?: string[] }>(bot: T | null | undefined): bot is T {
  return !!bot?.chiefOfStaff && !bot.section && (bot.managedSections?.length ?? 0) > 0;
}
