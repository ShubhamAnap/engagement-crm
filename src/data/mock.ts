export type Channel = "website" | "whatsapp" | "email" | "instagram" | "facebook";

export const org = {
  name: "EnerTech UPS Pvt. Ltd.",
  short: "EnerTech",
  plan: "Enterprise",
};

export const currentUser = {
  name: "Ananya Rao",
  role: "Support Manager",
  email: "ananya.rao@enertechups.com",
  initials: "AR",
};

export const kpis = [
  { label: "Active Conversations", value: "142", delta: "+12.4%", trend: "up" as const, hint: "vs. yesterday" },
  { label: "Today's Conversations", value: "1,284", delta: "+8.1%", trend: "up" as const, hint: "vs. yesterday" },
  { label: "Open Tickets", value: "63", delta: "-4.2%", trend: "down" as const, hint: "vs. last week" },
  { label: "Pending Escalations", value: "9", delta: "+3", trend: "up" as const, hint: "waiting on human" },
  { label: "AI Resolution Rate", value: "78.4%", delta: "+2.6pt", trend: "up" as const, hint: "last 7 days" },
  { label: "Human Resolution Rate", value: "21.6%", delta: "-2.6pt", trend: "down" as const, hint: "last 7 days" },
  { label: "Avg. Response Time", value: "11s", delta: "-3s", trend: "down" as const, hint: "first response" },
  { label: "Customer Satisfaction", value: "4.7/5", delta: "+0.2", trend: "up" as const, hint: "1,043 ratings" },
];

export const revenueKpis = [
  { label: "New Leads", value: "218", delta: "+18%", trend: "up" as const, hint: "this month" },
  { label: "Qualified Leads", value: "97", delta: "+11%", trend: "up" as const, hint: "44.5% of new" },
  { label: "Revenue Generated", value: "₹2.41 Cr", delta: "+9.3%", trend: "up" as const, hint: "closed won, MTD" },
  { label: "Open Opportunities", value: "₹6.08 Cr", delta: "+4.1%", trend: "up" as const, hint: "41 deals" },
];

export const conversationTrend = [
  { day: "Mon", ai: 320, human: 92 },
  { day: "Tue", ai: 402, human: 108 },
  { day: "Wed", ai: 388, human: 96 },
  { day: "Thu", ai: 466, human: 121 },
  { day: "Fri", ai: 512, human: 133 },
  { day: "Sat", ai: 298, human: 61 },
  { day: "Sun", ai: 214, human: 44 },
];

export const leadFunnel = [
  { stage: "Visitors", value: 12400 },
  { stage: "Engaged", value: 3820 },
  { stage: "Leads", value: 1180 },
  { stage: "Qualified", value: 512 },
  { stage: "Proposal", value: 186 },
  { stage: "Won", value: 74 },
];

export const channelSplit = [
  { name: "Website", value: 46, key: "website" },
  { name: "WhatsApp", value: 28, key: "whatsapp" },
  { name: "Email", value: 14, key: "email" },
  { name: "Instagram", value: 7, key: "instagram" },
  { name: "Facebook", value: 5, key: "facebook" },
];

export const pipelineByStage = [
  { stage: "New", value: 182 },
  { stage: "Qualified", value: 124 },
  { stage: "Proposal", value: 76 },
  { stage: "Negotiation", value: 41 },
  { stage: "Won", value: 28 },
];

export type Conversation = {
  id: string;
  customer: string;
  company: string;
  channel: Channel;
  preview: string;
  time: string;
  unread: number;
  assignee: string;
  status: "ai" | "human" | "escalated" | "resolved";
  confidence: number;
  tags: string[];
};

export const conversations: Conversation[] = [
  { id: "CV-4821", customer: "Rakesh Menon", company: "Kerala Diagnostics", channel: "whatsapp", preview: "Need runtime for 3 kVA online UPS with 8 batteries…", time: "2m", unread: 2, assignee: "AI · Sales Agent", status: "ai", confidence: 0.94, tags: ["Sales", "3 kVA"] },
  { id: "CV-4820", customer: "Priya Sharma", company: "Sunrise Hospitals", channel: "website", preview: "Our UPS is beeping continuously after a power cut.", time: "6m", unread: 1, assignee: "AI · Technical Agent", status: "escalated", confidence: 0.41, tags: ["Support", "Fault"] },
  { id: "CV-4818", customer: "Imran Qureshi", company: "Metro Datacenters", channel: "email", preview: "Please share the quotation for 10 kVA three-phase…", time: "18m", unread: 0, assignee: "Vikram S.", status: "human", confidence: 0.88, tags: ["Quotation"] },
  { id: "CV-4817", customer: "Neha Gupta", company: "Gupta Textiles", channel: "instagram", preview: "Do you have service engineers in Surat?", time: "34m", unread: 0, assignee: "AI · Support Agent", status: "ai", confidence: 0.81, tags: ["Service"] },
  { id: "CV-4815", customer: "Arun Pillai", company: "Coastal Marine", channel: "facebook", preview: "Warranty extension options for EN-5000X?", time: "1h", unread: 0, assignee: "AI · Warranty Agent", status: "resolved", confidence: 0.97, tags: ["Warranty"] },
  { id: "CV-4812", customer: "Sanjay Verma", company: "Verma Industries", channel: "whatsapp", preview: "Battery replacement cost for 12 x 42Ah SMF?", time: "2h", unread: 0, assignee: "AI · Sales Agent", status: "ai", confidence: 0.9, tags: ["Batteries"] },
  { id: "CV-4809", customer: "Fatima Sheikh", company: "Nexus Labs", channel: "website", preview: "Installation scheduled? We haven't heard back.", time: "3h", unread: 3, assignee: "Unassigned", status: "escalated", confidence: 0.37, tags: ["Installation", "SLA"] },
  { id: "CV-4801", customer: "Deepak Nair", company: "Nair Constructions", channel: "email", preview: "Datasheet for EN-10K3P please.", time: "5h", unread: 0, assignee: "AI · Email Agent", status: "resolved", confidence: 0.95, tags: ["Datasheet"] },
];

export const messages = [
  { id: 1, from: "customer" as const, text: "Hi, we have a 3 kVA online UPS at our Kochi lab. What runtime can I expect with 8 x 42Ah batteries at 60% load?", time: "10:02" },
  { id: 2, from: "ai" as const, text: "Hello Rakesh. With 8 × 42Ah SMF batteries (96V DC bus) on an EnerTech EN-3000X at 60% load (~1.8 kW), expected runtime is approximately 42–48 minutes at 25°C.", time: "10:02", confidence: 0.94, sources: ["EN-3000X Datasheet v4.2", "Battery Runtime Matrix 2026"] },
  { id: 3, from: "customer" as const, text: "And if we go to 12 batteries?", time: "10:04" },
  { id: 4, from: "ai" as const, text: "12 × 42Ah in the same string configuration gives roughly 68–74 minutes at the same load. I can also share the runtime chart PDF and a quotation for the additional battery bank.", time: "10:04", confidence: 0.91, sources: ["Battery Runtime Matrix 2026"] },
  { id: 5, from: "customer" as const, text: "Yes please send the quotation.", time: "10:06" },
];

export const aiAgents = [
  { name: "Sales Agent", desc: "Product discovery, pricing guidance, lead capture", status: "Active", health: 99.2, requests: 4820, latency: 780, memory: true, model: "gpt-5.6-sol", cost: "₹1,240" },
  { name: "Support Agent", desc: "Troubleshooting, ticket triage, SLA replies", status: "Active", health: 98.4, requests: 3910, latency: 690, memory: true, model: "gpt-5.6-sol", cost: "₹980" },
  { name: "Technical Agent", desc: "Deep diagnostics from manuals and schematics", status: "Active", health: 96.1, requests: 1420, latency: 1340, memory: true, model: "gemini-3.6-flash", cost: "₹610" },
  { name: "Warranty Agent", desc: "Warranty validation, RMA and claim workflow", status: "Active", health: 99.7, requests: 640, latency: 520, memory: false, model: "gemini-3.6-flash", cost: "₹190" },
  { name: "Battery Calculator Agent", desc: "Runtime, sizing and backup calculations", status: "Active", health: 99.9, requests: 1180, latency: 410, memory: false, model: "gpt-5.6-sol", cost: "₹320" },
  { name: "Quotation Agent", desc: "Builds and sends priced quotations", status: "Degraded", health: 87.5, requests: 512, latency: 2210, memory: true, model: "gpt-5.6-sol", cost: "₹470" },
  { name: "Follow-up Agent", desc: "Nurture sequences and reminders", status: "Active", health: 98.8, requests: 2260, latency: 350, memory: true, model: "gemini-3.6-flash", cost: "₹280" },
  { name: "Email Agent", desc: "Inbound email parsing and drafted replies", status: "Paused", health: 100, requests: 0, latency: 0, memory: true, model: "gpt-5.6-sol", cost: "₹0" },
];

export const knowledgeCollections = [
  { name: "Products", docs: 128, chunks: 4820, status: "Indexed", updated: "2h ago" },
  { name: "Manuals", docs: 96, chunks: 12480, status: "Indexed", updated: "1d ago" },
  { name: "FAQs", docs: 214, chunks: 1860, status: "Indexed", updated: "4h ago" },
  { name: "Datasheets", docs: 142, chunks: 3210, status: "Embedding", updated: "12m ago" },
  { name: "Warranty", docs: 34, chunks: 640, status: "Indexed", updated: "3d ago" },
  { name: "Installation", docs: 58, chunks: 2140, status: "Indexed", updated: "6h ago" },
  { name: "Policies", docs: 22, chunks: 410, status: "Stale", updated: "21d ago" },
  { name: "Pricing", docs: 41, chunks: 980, status: "Indexed", updated: "1h ago" },
];

export const products = [
  { sku: "EN-1000X", name: "EnerTech 1 kVA Online UPS", category: "Online UPS", stock: "In Stock", qty: 184, price: "₹18,400", weight: 0.82, batteries: "2 × 12V 7Ah", runtime: "12 min @ 70%" },
  { sku: "EN-3000X", name: "EnerTech 3 kVA Online UPS", category: "Online UPS", stock: "In Stock", qty: 92, price: "₹52,900", weight: 0.94, batteries: "8 × 12V 42Ah", runtime: "45 min @ 60%" },
  { sku: "EN-5000X", name: "EnerTech 5 kVA Online UPS", category: "Online UPS", stock: "Low Stock", qty: 14, price: "₹86,500", weight: 0.88, batteries: "16 × 12V 42Ah", runtime: "38 min @ 70%" },
  { sku: "EN-10K3P", name: "EnerTech 10 kVA Three Phase", category: "Three Phase", stock: "In Stock", qty: 27, price: "₹1,84,000", weight: 0.79, batteries: "32 × 12V 65Ah", runtime: "30 min @ 80%" },
  { sku: "EN-20K3P", name: "EnerTech 20 kVA Three Phase", category: "Three Phase", stock: "Made to Order", qty: 0, price: "₹3,42,000", weight: 0.61, batteries: "32 × 12V 100Ah", runtime: "26 min @ 80%" },
  { sku: "EN-SMF42", name: "SMF Battery 12V 42Ah", category: "Batteries", stock: "In Stock", qty: 640, price: "₹4,120", weight: 0.72, batteries: "—", runtime: "—" },
  { sku: "EN-ISO7K", name: "Isolation Transformer 7.5 kVA", category: "Accessories", stock: "In Stock", qty: 46, price: "₹31,800", weight: 0.44, batteries: "—", runtime: "—" },
  { sku: "EN-SNMP", name: "SNMP Network Card", category: "Accessories", stock: "In Stock", qty: 210, price: "₹6,900", weight: 0.5, batteries: "—", runtime: "—" },
];

export type Lead = {
  id: string;
  score: number;
  status: "New" | "Contacted" | "Qualified" | "Proposal" | "Won" | "Lost";
  priority: "High" | "Medium" | "Low";
  source: Channel;
  name: string;
  company: string;
  phone: string;
  email: string;
  product: string;
  owner: string;
  lastActivity: string;
  nextFollowUp: string;
  value: string;
};

export const leads: Lead[] = [
  { id: "LD-2201", score: 92, status: "Qualified", priority: "High", source: "whatsapp", name: "Rakesh Menon", company: "Kerala Diagnostics", phone: "+91 98470 11234", email: "rakesh@keraladx.in", product: "EN-3000X", owner: "Vikram S.", lastActivity: "2m ago", nextFollowUp: "Today, 4:30 PM", value: "₹6.4L" },
  { id: "LD-2199", score: 88, status: "Proposal", priority: "High", source: "email", name: "Imran Qureshi", company: "Metro Datacenters", phone: "+91 99300 55110", email: "imran@metrodc.com", product: "EN-10K3P", owner: "Vikram S.", lastActivity: "18m ago", nextFollowUp: "Tomorrow, 11:00 AM", value: "₹22.8L" },
  { id: "LD-2195", score: 74, status: "Contacted", priority: "Medium", source: "website", name: "Priya Sharma", company: "Sunrise Hospitals", phone: "+91 98111 34567", email: "priya.s@sunrisehosp.in", product: "EN-5000X", owner: "Meera J.", lastActivity: "1h ago", nextFollowUp: "Fri, 10:00 AM", value: "₹9.1L" },
  { id: "LD-2190", score: 66, status: "New", priority: "Medium", source: "instagram", name: "Neha Gupta", company: "Gupta Textiles", phone: "+91 90990 77123", email: "neha@guptatex.com", product: "EN-1000X", owner: "Unassigned", lastActivity: "3h ago", nextFollowUp: "Unscheduled", value: "₹1.8L" },
  { id: "LD-2186", score: 58, status: "Contacted", priority: "Low", source: "facebook", name: "Arun Pillai", company: "Coastal Marine", phone: "+91 94470 88320", email: "arun@coastalmarine.in", product: "EN-SMF42", owner: "Meera J.", lastActivity: "5h ago", nextFollowUp: "Mon, 3:00 PM", value: "₹0.9L" },
  { id: "LD-2181", score: 81, status: "Qualified", priority: "High", source: "whatsapp", name: "Sanjay Verma", company: "Verma Industries", phone: "+91 98200 41122", email: "sanjay@vermaind.com", product: "EN-20K3P", owner: "Rohan D.", lastActivity: "1d ago", nextFollowUp: "Thu, 2:00 PM", value: "₹34.2L" },
  { id: "LD-2177", score: 45, status: "Lost", priority: "Low", source: "website", name: "Deepak Nair", company: "Nair Constructions", phone: "+91 99460 12876", email: "deepak@nairbuild.in", product: "EN-1000X", owner: "Rohan D.", lastActivity: "3d ago", nextFollowUp: "—", value: "₹1.2L" },
  { id: "LD-2174", score: 95, status: "Won", priority: "High", source: "email", name: "Fatima Sheikh", company: "Nexus Labs", phone: "+91 98330 90011", email: "fatima@nexuslabs.io", product: "EN-10K3P", owner: "Vikram S.", lastActivity: "4d ago", nextFollowUp: "—", value: "₹18.6L" },
];

export const pipelineStages = [
  { key: "new", title: "New Lead", ids: ["LD-2190"] },
  { key: "qualified", title: "Qualified", ids: ["LD-2201", "LD-2181"] },
  { key: "proposal", title: "Proposal", ids: ["LD-2199", "LD-2195"] },
  { key: "negotiation", title: "Negotiation", ids: ["LD-2186"] },
  { key: "won", title: "Won", ids: ["LD-2174"] },
  { key: "lost", title: "Lost", ids: ["LD-2177"] },
];

export const channelsConfig = [
  { name: "Website Chat", key: "website", status: "Connected", health: 100, volume: "584 / day", detail: "widget.enertechups.com" },
  { name: "WhatsApp Business", key: "whatsapp", status: "Connected", health: 98, volume: "352 / day", detail: "+91 80 4718 9000" },
  { name: "Email", key: "email", status: "Connected", health: 100, volume: "178 / day", detail: "support@enertechups.com" },
  { name: "Instagram", key: "instagram", status: "Connected", health: 92, volume: "88 / day", detail: "@enertechups" },
  { name: "Facebook Messenger", key: "facebook", status: "Degraded", health: 71, volume: "62 / day", detail: "EnerTech UPS Pvt Ltd" },
  { name: "REST API", key: "api", status: "Connected", health: 100, volume: "12.4k calls / day", detail: "v2 · 4 keys active" },
  { name: "Webhooks", key: "webhook", status: "Action Required", health: 44, volume: "3 failing", detail: "6 endpoints" },
];

export const handoffQueue = [
  { id: "CV-4820", customer: "Priya Sharma", company: "Sunrise Hospitals", reason: "Low AI confidence (0.41)", waiting: "4m", state: "Waiting", agent: "—", priority: "High" },
  { id: "CV-4809", customer: "Fatima Sheikh", company: "Nexus Labs", reason: "SLA breach risk", waiting: "12m", state: "Waiting", agent: "—", priority: "High" },
  { id: "CV-4794", customer: "Mohit Rana", company: "Rana Cold Storage", reason: "Customer requested human", waiting: "1m", state: "Assigned", agent: "Vikram S.", priority: "Medium" },
  { id: "CV-4788", customer: "Latha Krishnan", company: "TN Power Systems", reason: "Pricing approval needed", waiting: "9m", state: "Working", agent: "Meera J.", priority: "Medium" },
  { id: "CV-4771", customer: "Zoya Khan", company: "Skyline Realty", reason: "Escalated by AI", waiting: "—", state: "Resolved", agent: "Rohan D.", priority: "Low" },
];

export const activity = [
  { who: "AI · Quotation Agent", what: "sent quotation QT-1182 to Metro Datacenters", when: "2m ago" },
  { who: "Vikram S.", what: "took over conversation CV-4818", when: "16m ago" },
  { who: "AI · Support Agent", what: "resolved 14 conversations", when: "38m ago" },
  { who: "System", what: "re-indexed Datasheets collection (3,210 chunks)", when: "1h ago" },
  { who: "Meera J.", what: "moved LD-2195 to Proposal", when: "2h ago" },
  { who: "AI · Follow-up Agent", what: "scheduled 22 follow-up reminders", when: "3h ago" },
];

export const topQuestions = [
  { q: "What runtime will I get with X batteries?", count: 812, resolved: 96 },
  { q: "UPS is beeping continuously — what does it mean?", count: 640, resolved: 88 },
  { q: "What is the warranty period on the EN series?", count: 512, resolved: 99 },
  { q: "Do you provide installation in my city?", count: 388, resolved: 74 },
  { q: "Price of 5 kVA online UPS", count: 356, resolved: 92 },
  { q: "Difference between line-interactive and online UPS", count: 291, resolved: 97 },
];

export const agentPerformance = [
  { name: "Vikram S.", handled: 184, csat: 4.8, firstResponse: "42s", resolution: "18m" },
  { name: "Meera J.", handled: 162, csat: 4.6, firstResponse: "58s", resolution: "22m" },
  { name: "Rohan D.", handled: 148, csat: 4.5, firstResponse: "1m 10s", resolution: "26m" },
  { name: "Anita K.", handled: 121, csat: 4.7, firstResponse: "49s", resolution: "20m" },
];

export const liveAiSessions = [
  { id: "CV-4821", customer: "Rakesh Menon", agent: "Sales Agent", confidence: 0.94, tokens: 8420, latency: 740, memory: "Warm", escalation: "None", channel: "whatsapp" as Channel, sources: 3 },
  { id: "CV-4817", customer: "Neha Gupta", agent: "Support Agent", confidence: 0.81, tokens: 3120, latency: 620, memory: "Warm", escalation: "None", channel: "instagram" as Channel, sources: 2 },
  { id: "CV-4820", customer: "Priya Sharma", agent: "Technical Agent", confidence: 0.41, tokens: 11240, latency: 1810, memory: "Cold", escalation: "Triggered", channel: "website" as Channel, sources: 1 },
  { id: "CV-4812", customer: "Sanjay Verma", agent: "Sales Agent", confidence: 0.9, tokens: 5240, latency: 690, memory: "Warm", escalation: "None", channel: "whatsapp" as Channel, sources: 4 },
  { id: "CV-4806", customer: "Latha Krishnan", agent: "Quotation Agent", confidence: 0.67, tokens: 14980, latency: 2240, memory: "Warm", escalation: "Watch", channel: "email" as Channel, sources: 5 },
];

export const automations = [
  { name: "New Lead → AI Qualification → CRM", runs: 1284, success: 98.2, status: "Live", updated: "2d ago" },
  { name: "Abandoned Chat → WhatsApp Follow-up", runs: 642, success: 94.1, status: "Live", updated: "6d ago" },
  { name: "Quotation Sent → 48h Reminder", runs: 318, success: 99.0, status: "Live", updated: "1d ago" },
  { name: "Low CSAT → Manager Alert", runs: 46, success: 100, status: "Live", updated: "12d ago" },
  { name: "Warranty Expiry → Renewal Campaign", runs: 0, success: 0, status: "Draft", updated: "3h ago" },
];