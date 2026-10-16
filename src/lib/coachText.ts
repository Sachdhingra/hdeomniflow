// Older coach messages were stored with the model's raw JSON envelope as their
// text (a bug since fixed on the server). Show the actual reply for those rows.
export function displayCoachText(content: string): string {
  const text = content.trim();
  if (!/^\{[\s\S]*"reply"/.test(text)) return content;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.reply === "string") return displayCoachText(parsed.reply);
  } catch {
    // not valid JSON — fall through and show it as is
  }
  return content;
}
