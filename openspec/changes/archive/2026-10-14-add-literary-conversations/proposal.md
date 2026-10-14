## Why

Marginalia exists so a reader can discuss a novel with an AI that cites the actual text. The foundation change delivered the trustworthy text layer (passages, locators, bounded full-text search, quote verification) but deliberately no AI. That layer is now stable, so this change adds the conversation feature on top of it, the product's core value.

## What Changes

- Configurable AI providers through the Vercel AI SDK. The operator selects a provider and model by environment variables (for example OpenAI, Anthropic, Google, or any OpenAI-compatible endpoint such as Ollama). The instance works without a provider, and conversation features say so.
- Persistent conversations, each scoped to a set of books (editions). The UI creates single-book conversations for now, but the data model, tools, and citations are built for several books so cross-book and series discussion (GitHub issue #1) can follow without a rewrite. Messages are stored in PostgreSQL, can be listed, resumed, renamed, and deleted, and the assistant's replies stream to the browser as they are generated.
- Retrieval as a model tool. The model searches and reads the conversation's books through tools backed by the existing `retrieval` module (search, resolve with context) rather than receiving the book in its prompt. Tool calls are stored and visible in the UI.
- Verified citations. The model cites passages by locator and exact quote. The server verifies every citation with `verifyQuote` before it is shown as verified, and unverifiable citations are visibly flagged rather than silently trusted.
- Evidence versus interpretation. The assistant is instructed to separate what the text says (cited) from what it infers, and answers carry that structure so the UI can render quoted evidence distinctly from interpretation.
- A challenging discussion stance. The system prompt directs the assistant to take positions, push back on weak readings, name counter-evidence from the text, and avoid flattery, while staying grounded in the text.
- UI: a conversation list per book, a streaming chat view with citation chips linking to the passage view (`/p/$locator`), and provider status.

Non-goals: cross-book and series conversations in the UI, a settings UI for providers (environment configuration only), reader progress and spoiler enforcement (`add-reading-progress`), AI preprocessing of books (`add-library-providers`), durable cross-conversation memory (`add-interpretive-memory`), embeddings or pgvector retrieval, and per-user provider keys or in-app provider settings.

## Capabilities

### New Capabilities

- `ai-providers`: Environment-configured language model selection through the Vercel AI SDK, availability reporting, and secret handling.
- `literary-conversations`: Persistent, streaming conversations over a set of books (one in the MVP); retrieval tools; verified citations; evidence/interpretation framing; and the challenging discussion stance.

### Modified Capabilities

- `self-hosting`: New provider environment variables are documented and validated at startup, and a missing provider does not prevent startup.
- `library-browsing`: The book detail page links to conversations containing that book.

## Impact

- **Code**: new `modules/conversation` (tables, orchestration, prompts, citation checking) and `modules/ai` (provider factory); new server routes for streaming chat and server functions for conversation CRUD; new UI routes and components; config additions.
- **Dependencies**: `ai` (Vercel AI SDK), `@ai-sdk/react`, and provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`).
- **Data**: new tables `conversations`, `conversation_editions`, and `messages` in a new migration. No change to canonical text tables.
- **Privacy and cost**: passages the model retrieves, plus the conversation, are sent to the configured provider. Docs must state this, and a local OpenAI-compatible endpoint is the private option.
- **Spoilers**: until `add-reading-progress` ships, retrieval for conversations is unbounded, so the assistant can reveal later plot. The design leaves a nullable per-book position bound on the conversation that the later change will populate, and the UI warns about this.
