# Knowledge Base + RAG

## Stack (locked)

- **Files:** Supabase Storage bucket `knowledge`
- **Vectors:** `pgvector` on Supabase (`knowledge_chunks.embedding`)
- **Embeddings:** OpenAI `text-embedding-3-small` (1536 dims)
- **Chat:** existing GPT-4o-mini with retrieved context
- **Catalogue PDFs:** stored in Storage; bot returns download URL when asked

No Pinecone required for v1.

## Setup

1. Run `004_knowledge_rag.sql` in the Supabase SQL Editor.
2. Confirm `.env` has `OPENAI_API_KEY` (used for embeddings + chat).
3. Optional: `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`

## Usage

1. Open **Knowledge Base** in the app.
2. Create/select a collection.
3. Upload `.pdf`, `.txt`, or `.md`.
4. Wait until status is **ready** (chunks embedded).
5. Ask EnerBot product/manual questions — answers use retrieved chunks.
6. Ask for a **catalogue / datasheet / PDF** — bot includes download links when documents/products have files.
