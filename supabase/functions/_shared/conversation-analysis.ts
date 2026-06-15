// Shared keyword-based conversation analyzer used by:
//   - interakt-webhook (analyses each inbound)
//   - nurture-engine  (uses sentiment/concern/intent to pick the right template)
//
// Pure functions, no external deps. Hindi/Hinglish-aware where reasonable.

export type Sentiment = "positive" | "negative" | "neutral";
export type LengthCategory = "short" | "medium" | "long";

export type Concern =
  | "price"
  | "delivery"
  | "quality"
  | "design"
  | "customization"
  | "comparison"
  | "timeline"
  | null;

export type Intent =
  | "interested"
  | "objection"
  | "question"
  | "ready_to_buy"
  | "not_interested"
  | "neutral";

const POSITIVE = [
  "yes","yeah","yep","sure","ok","okay","good","great","love","interested",
  "perfect","awesome","nice","when","send","share","show","want","need",
  "haan","ha","theek","accha","achha","sahi","pasand","chahiye","kab",
];
const NEGATIVE = [
  "no","not","expensive","costly","high","budget","cant","cannot","don't",
  "dont","later","busy","skip","leave","stop","unsubscribe","mat","nahi",
  "nah","mehnga","mahanga","band","baad",
];
const READY = ["buy","book","order","pay","payment","confirm","finalize","final","let's go","done","deal","kharidna","book karna"];
const QUESTION_MARK = /[?]/;

const CONCERN_PATTERNS: { concern: Exclude<Concern, null>; words: string[] }[] = [
  { concern: "price",        words: ["price","cost","rate","emi","discount","offer","mehnga","kitna","kitne","kitnay","kitne ka","budget","afford","expensive","cheap","sasta"] },
  { concern: "delivery",     words: ["deliver","delivery","ship","when will","arrive","pohanch","kab aayega","kab milega","dispatch","logistic"] },
  { concern: "quality",      words: ["quality","durab","warranty","guarantee","material","wood","plywood","mdf","tikau","kitne saal","last","strong","mazboot","break","tooth","damage"] },
  { concern: "design",       words: ["design","colour","color","look","style","modern","traditional","minimalist","finish","shade","look like","kaisa","dikhe"] },
  { concern: "customization",words: ["custom","modify","change","size","resize","alag","badal","customise","customize","fit","measure","measurement","banwana"] },
  { concern: "comparison",   words: ["vs","versus","compare","other brand","ikea","pepperfry","urban ladder","godrej","nilkamal","better than","why you","kyon"] },
  { concern: "timeline",     words: ["this month","next month","when can","by","before","urgent","jaldi","abhi","right now","is hafta","is mahine"] },
];

const INTENT_BUDGET_QUESTION = /how much|kitna|kitne|kitnay|price\??|cost\??|rate\??/i;
const INTENT_DELIVERY_QUESTION = /when (will|can).*?(deliver|come|arrive)|delivery time|kab milega|kab aayega/i;
const INTENT_CUSTOMIZE = /can you (modify|customise|customize|change)|customize karenge|alag kar/i;
const INTENT_COMPARE = /(vs|versus|compared to|better than|other brand)/i;

export interface InboundAnalysis {
  sentiment: Sentiment;
  concern: Concern;
  intent: Intent;
  length_category: LengthCategory;
  keywords_matched: string[];
}

export function analyzeInbound(raw: string): InboundAnalysis {
  const text = (raw || "").toLowerCase().trim();
  const len = text.length;
  const length_category: LengthCategory = len < 20 ? "short" : len > 50 ? "long" : "medium";

  const matched: string[] = [];
  let posHits = 0, negHits = 0;
  for (const w of POSITIVE) if (text.includes(w)) { posHits++; matched.push("+" + w); }
  for (const w of NEGATIVE) if (text.includes(w)) { negHits++; matched.push("-" + w); }

  // Intent
  let intent: Intent = "neutral";
  if (READY.some(w => text.includes(w))) intent = "ready_to_buy";
  else if (negHits > posHits) intent = text.includes("not interested") || text.includes("nahi chahiye") ? "not_interested" : "objection";
  else if (QUESTION_MARK.test(text) || INTENT_BUDGET_QUESTION.test(text) || INTENT_DELIVERY_QUESTION.test(text) || INTENT_CUSTOMIZE.test(text) || INTENT_COMPARE.test(text)) intent = "question";
  else if (posHits > 0) intent = "interested";

  // Concern (first match wins; check more specific concerns first)
  let concern: Concern = null;
  for (const c of CONCERN_PATTERNS) {
    if (c.words.some(w => text.includes(w))) { concern = c.concern; break; }
  }

  // Sentiment: balance hits + intent
  let sentiment: Sentiment = "neutral";
  if (intent === "ready_to_buy" || intent === "interested") sentiment = "positive";
  else if (intent === "not_interested" || (negHits > 0 && negHits >= posHits)) sentiment = "negative";
  else if (posHits > negHits) sentiment = "positive";

  return { sentiment, concern, intent, length_category, keywords_matched: matched.slice(0, 8) };
}

// Map (journey stage, concern, days_since_response) → preferred template title.
// nurture-engine does exact-title lookup against message_templates.
export function pickTemplateTitle(opts: {
  journeyStage: string;
  concern: Concern;
  intent: Intent | null;
  daysSinceLastInbound: number;
  unansweredCount: number;
}): { title: string | null; messageKind: string } {
  const { journeyStage, concern, intent, daysSinceLastInbound, unansweredCount } = opts;

  // No-response escalation always wins if we're being ignored
  if (unansweredCount >= 1 && daysSinceLastInbound >= 7)
    return { title: "No response 7d empathy", messageKind: "no_response_d7" };
  if (unansweredCount >= 1 && daysSinceLastInbound >= 3)
    return { title: "No response 72h", messageKind: "no_response_d3" };
  if (unansweredCount >= 1 && daysSinceLastInbound >= 2)
    return { title: "No response 48h", messageKind: "no_response_d2" };

  // Concern-specific responses — titles match seeded message_templates rows exactly
  if (concern === "price")          return { title: "Objection Address - Budget", messageKind: "objection_price" };
  if (concern === "delivery")       return { title: "Delivery Reassurance", messageKind: "concern_delivery" };
  if (concern === "quality")        return { title: "Quality Proof", messageKind: "concern_quality" };
  if (concern === "customization")  return { title: "Objection Address - Fit", messageKind: "concern_customization" };
  if (concern === "comparison")     return { title: "Product Comparison", messageKind: "objection_comparison" };

  // Intent-driven
  if (intent === "objection")       return { title: "Confidence Boost", messageKind: "objection_general" };
  if (intent === "ready_to_buy")    return { title: "Move to Close", messageKind: "ready_nudge" };

  // Stage-driven defaults — map to real template titles per stage
  if (journeyStage === "problem")      return { title: "Problem Acknowledgment", messageKind: "curiosity" };
  if (journeyStage === "exploration")  return { title: "Guided Selling - Style", messageKind: "curiosity" };
  if (journeyStage === "evaluation")   return { title: "Family Alignment", messageKind: "curiosity" };
  if (journeyStage === "reassurance")  return { title: "Confidence Boost", messageKind: "relationship" };
  if (journeyStage === "decision")     return { title: "Final Urgency", messageKind: "decision_nudge" };
  if (journeyStage === "cold")         return { title: "Problem Acknowledgment", messageKind: "cold_reengage" };

  return { title: null, messageKind: "stage_default" };
}
