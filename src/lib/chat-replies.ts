/** Placeholder bot reply until OpenAI + RAG is wired. */
export function buildPlaceholderAiReply(customerText: string): string {
  const t = customerText.toLowerCase();
  if (t.includes("runtime") || t.includes("battery")) {
    return "Thanks for your question about runtime. Based on typical EnerTech configurations, an EN-3000X with 8 × 42Ah batteries gives ~42–48 minutes at 60% load. A specialist can refine this for your exact load — I've logged your message in our inbox.";
  }
  if (t.includes("price") || t.includes("quote") || t.includes("quotation")) {
    return "Happy to help with pricing. If you already shared the product or kW, our sales team will confirm the commercial offer shortly — your request is in EnerTech Engage.";
  }
  if (t.includes("human") || t.includes("call me") || t.includes("talk to")) {
    return "Okay sir, please wait a moment — I will get back to you shortly.";
  }
  return "Thanks for messaging EnerTech. I've received your note and it's now in our Omnichannel Inbox. How else can I help — products, runtime, service, or a quotation?";
}
