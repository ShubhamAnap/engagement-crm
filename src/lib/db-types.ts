/**
 * Database entity types matching supabase/migrations/003_core_schema.sql
 * Keep in sync when schema changes.
 */

import type { AppRole } from "./types";

export type ChannelType =
  | "website"
  | "whatsapp"
  | "email"
  | "instagram"
  | "facebook"
  | "indiamart"
  | "tradeindia"
  | "brainmine"
  | "api"
  | "webhook";

export type ConversationStatus = "ai" | "human" | "escalated" | "resolved" | "closed";
export type MessageSender = "customer" | "ai" | "agent" | "system";
export type LeadStatus =
  | "New"
  | "Contacted"
  | "Qualified"
  | "Proposal"
  | "Negotiation"
  | "Won"
  | "Lost";
export type PriorityLevel = "High" | "Medium" | "Low";
export type StockStatus = "In Stock" | "Low Stock" | "Made to Order" | "Out of Stock";
export type ChannelStatus = "Connected" | "Degraded" | "Disconnected" | "Action Required";
export type AgentStatus = "Active" | "Paused" | "Degraded";
export type KnowledgeStatus = "Indexed" | "Embedding" | "Stale" | "Failed";
export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export type DbCustomer = {
  id: string;
  org_id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DbProduct = {
  id: string;
  org_id: string;
  sku: string;
  name: string;
  category: string | null;
  description: string | null;
  stock_status: StockStatus;
  quantity: number;
  price_paise: number | null;
  price_label: string | null;
  ai_weight: number;
  battery_spec: string | null;
  runtime_spec: string | null;
  specs: Record<string, unknown>;
  is_active: boolean;
  catalog_pdf_path?: string | null;
  catalog_pdf_url?: string | null;
  created_at: string;
  updated_at: string;
};

export type DbLead = {
  id: string;
  org_id: string;
  customer_id: string | null;
  product_id: string | null;
  external_ref: string | null;
  score: number;
  status: LeadStatus;
  priority: PriorityLevel;
  source: ChannelType | null;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  product_label: string | null;
  /** Master: what the enquiry is about */
  requirement: string | null;
  notes: string | null;
  tags: string[];
  location: string | null;
  /** Display name for assigned salesperson */
  sales_person: string | null;
  owner_id: string | null;
  value_paise: number | null;
  value_label: string | null;
  last_activity_at: string | null;
  next_follow_up_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DbChannel = {
  id: string;
  org_id: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  health: number;
  detail: string | null;
  config: Record<string, unknown>;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type DbAgent = {
  id: string;
  org_id: string;
  key: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  model: string;
  memory_enabled: boolean;
  system_prompt: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DbConversation = {
  id: string;
  org_id: string;
  customer_id: string | null;
  lead_id: string | null;
  channel_id: string | null;
  channel: ChannelType;
  external_ref: string | null;
  subject: string | null;
  preview: string | null;
  status: ConversationStatus;
  unread_count: number;
  assignee_id: string | null;
  assignee_label: string | null;
  agent_id: string | null;
  confidence: number | null;
  tags: string[];
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  visitor_company: string | null;
  widget_session_id: string | null;
  metadata: Record<string, unknown>;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DbMessage = {
  id: string;
  org_id: string;
  conversation_id: string;
  sender: MessageSender;
  sender_profile_id: string | null;
  body: string;
  confidence: number | null;
  sources: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type DbKnowledgeCollection = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: KnowledgeStatus;
  doc_count: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
};

export type DbKnowledgeDocument = {
  id: string;
  org_id: string;
  collection_id: string;
  title: string;
  source_url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  status: DocumentStatus;
  chunk_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DbKnowledgeChunk = {
  id: string;
  org_id: string;
  document_id: string;
  collection_id: string;
  chunk_index: number;
  content: string;
  token_estimate: number;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type { AppRole };
