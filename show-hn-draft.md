# Show HN Draft -- ACP (Agent Control Protocol)

---

## Title (primary)

**Show HN: ACP -- Open protocol for AI agents to operate existing application UIs**

## Alternative Titles

1. **Show HN: ACP -- A protocol that lets AI agents fill forms, click buttons, and navigate apps**
2. **Show HN: ACP -- Structured protocol for agents to control live application interfaces**
3. **Show HN: ACP -- The missing protocol between AI agents and existing UIs**

---

## Body

We're open-sourcing ACP (Agent Control Protocol), a protocol specification that lets AI agents operate existing application interfaces -- fill form fields, click buttons, navigate between screens -- through structured commands instead of vision or DOM scraping.

**The gap we saw:** AI agents can access data and tools (MCP), coordinate with each other (A2A), stream events to frontends (AG-UI), and even generate new UI components (A2UI). But none of these protocols let an agent operate an application's existing interface. If you have a form with 20 fields, no current protocol gives the agent a way to fill them.

**How ACP works:** The application sends a manifest describing its screens, fields, and actions -- this is the agent's map of the UI. The user sends natural language ("fill the contact form with my details"). The agent responds with structured commands (`fill`, `click`, `navigate`, `select`). An SDK on the application side executes those commands against the live interface and reports results back, per action, with sequence IDs for reliable multi-step workflows.

**What's in this release:**

- Formal specification (SPEC.md, 1500+ lines, RFC-style)
- JSON Schema for all message types
- 14 UI actions: navigate, fill, clear, select, click, highlight, focus, scroll_to, show_toast, ask_confirm, open_modal, close_modal, enable, disable
- 15 field types (text, number, currency, date, email, select, autocomplete, file, etc.)
- 5 annotated example message exchanges
- Conformance test suite for validating implementations
- Apache 2.0 license

**Why we built this:** We built ACP for our own product (Emitta, an invoicing/ERP platform in Brazil) where an AI agent helps users fill tax forms by voice and text. We've been running it in production. After watching the agent-protocol ecosystem grow -- MCP, A2A, AG-UI, A2UI -- with nobody addressing "operate existing UI," we decided to extract the protocol and open the spec.

**How it compares to alternatives:**

- *AG-UI* streams events to the frontend, but the frontend must implement handlers for every action. The agent cannot autonomously fill a field.
- *A2UI* generates new declarative UI, but cannot touch the application's existing screens.
- *Computer Use / vision-based* approaches work by screenshot analysis and pixel coordinates. They're slow, expensive in tokens, and break when the UI changes. They don't work well cross-platform.
- *ACP*: the application declares its own structure. The agent operates with certainty, not heuristics. Works on any platform (web, mobile, desktop) because the SDK mediates between protocol and native UI layer.

**Links:**

- Spec + repo: https://github.com/agent-control-protocol/acp
- Website: https://acp-protocol.org
- First production implementation (Go engine): https://primoia.ai

**What we'd love feedback on:**

- Is the action set (14 actions) sufficient for your use cases? What's missing?
- Should we publish reference SDK implementations (React, Flutter) as open source?
- Interest in AG-UI + ACP integration -- AG-UI for streaming, ACP for UI control?

We're a small team from Brazil. Happy to answer questions about design decisions, the production implementation, or anything else.
