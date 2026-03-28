# ACP -- Agent Control Protocol

**An open protocol that lets AI agents control existing application interfaces.**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Spec Version](https://img.shields.io/badge/spec-v2.0-green.svg)](spec/acp-v2.json)
[![Status](https://img.shields.io/badge/status-draft-orange.svg)](spec/SPEC.md)

---

## The Gap

```
MCP  (Anthropic)    ->  LLM <-> Data/Tools
A2A  (Google)       ->  Agent <-> Agent
AG-UI (CopilotKit)  ->  Agent -> Frontend streaming
A2UI (Google)       ->  Agent -> Generated UI
ACP                 ->  Agent <-> Existing Application UI  <-- you are here
```

Existing protocols let agents access data (MCP), coordinate with other agents (A2A), stream events to frontends (AG-UI), and generate new UI (A2UI). None of them allow an agent to **operate an existing application's interface**.

AG-UI streams events, but the frontend must implement handlers for every action -- the agent cannot fill a form field on its own. A2UI generates new declarative UI components, but it cannot touch the application's existing screens.

ACP fills this gap. The application declares its UI structure through a manifest, and the agent sends structured commands -- `set_field`, `click`, `navigate` -- that the SDK executes against the live interface.

## Try It

**Live demo (no setup):** [primoia.ai/sandbox](https://primoia.ai/sandbox)

**Run locally:**

```bash
git clone https://github.com/agent-control-protocol/acp-demo.git
cd acp-demo && npm install
cp .env.example .env   # add your OpenAI API key
npm start              # open http://localhost:3098
```

Type *"Register my dog Max, owner Sarah Connor, sarah@skynet.com"* and watch the agent fill the form.

## How It Works

**1. Describe** -- The application sends a manifest describing its screens, fields, actions, and modals. This is the agent's map of the interface.

**2. Converse** -- The user sends natural-language text. The agent interprets intent using the manifest as context, knowing exactly what fields exist, what actions are available, and what screens can be navigated to.

**3. Execute** -- The agent sends UI commands (`set_field`, `click`, `navigate`). The SDK on the application side executes them against the live interface and reports results back.

```
 User         Application (SDK)         Agent (Engine)
  |                  |                        |
  |  "Fill out the   |                        |
  |   contact form"  |                        |
  |----------------->|   manifest + message    |
  |                  |----------------------->|
  |                  |                        |  (understands UI structure,
  |                  |                        |   plans commands)
  |                  |   commands: set_field,  |
  |                  |   click                 |
  |                  |<-----------------------|
  |                  |                        |
  |  (fields set,    |   results: ok/fail     |
  |   button clicks) |----------------------->|
  |                  |                        |
  |                  |   chat: "Done, form    |
  |                  |    submitted."         |
  |                  |<-----------------------|
  |  "Done, form     |                        |
  |   submitted."    |                        |
  |<-----------------|                        |
```

## Quick Example

### 1. Application sends manifest

```json
{
  "type": "manifest",
  "app": "contact-portal",
  "currentScreen": "contact",
  "screens": {
    "contact": {
      "id": "contact",
      "label": "Contact Form",
      "fields": [
        { "id": "name", "type": "text", "label": "Full Name", "required": true },
        { "id": "email", "type": "email", "label": "Email", "required": true },
        { "id": "message", "type": "textarea", "label": "Message" }
      ],
      "actions": [
        { "id": "submit", "label": "Send Message" }
      ]
    }
  }
}
```

Then user sends text:

```json
{
  "type": "text",
  "message": "Send a message to support. My name is Alice Park, email alice@example.com. Tell them I need help resetting my account."
}
```

### 2. Agent responds with commands

```json
{
  "type": "command",
  "seq": 1,
  "actions": [
    { "do": "set_field", "field": "name", "value": "Alice Park" },
    { "do": "set_field", "field": "email", "value": "alice@example.com" },
    { "do": "set_field", "field": "message", "value": "Hello, I need help resetting my account. Could you assist me with this? Thank you." },
    { "do": "click", "action": "submit" }
  ]
}
```

### 3. SDK reports results

```json
{
  "type": "result",
  "seq": 1,
  "results": [
    { "index": 0, "success": true },
    { "index": 1, "success": true },
    { "index": 2, "success": true },
    { "index": 3, "success": true }
  ]
}
```

The agent sees the manifest, understands the UI, and operates it with structured commands. No vision models. No DOM scraping. No guessing.

## What ACP Defines

- **8 UI Actions**: `navigate`, `set_field`, `clear`, `click`, `show_toast`, `ask_confirm`, `open_modal`, `close_modal`

- **15 Field Types**: `text`, `number`, `currency`, `date`, `datetime`, `email`, `phone`, `masked`, `select`, `autocomplete`, `checkbox`, `radio`, `textarea`, `file`, `hidden`

- **Manifest Structure**: screens, fields, actions, modals -- everything the agent needs to understand the application's UI and current state

- **Command-Result Loop**: the agent sends commands with sequence IDs; the SDK reports success or failure per action, enabling reliable multi-step workflows

- **Streaming**: token-by-token chat responses for real-time UX alongside command execution

## Why Not Vision/Scraping?

- **Vision-based approaches** (screenshot analysis, pixel coordinates) are slow, expensive in tokens, and fragile across resolutions and themes. A single UI redesign breaks everything.

- **DOM scraping** couples the agent to implementation details that change on every deploy. It does not work on native mobile or desktop applications at all.

- **RPA tools** are heavyweight, enterprise-only, and designed for batch automation -- not real-time conversational interaction.

- **ACP**: the application declares its own structure. The agent operates with certainty, not heuristics. Works on any platform -- web, mobile, desktop -- because the SDK mediates between the protocol and the native UI layer.

## Protocol, Not Product

ACP is a protocol specification, not a product. Anyone can implement an ACP-compliant engine (the agent side) or SDK (the application side). The protocol defines the contract between them.

The first production implementation is [Vocall Engine](https://primoia.ai) by Primoia, which powers ACP alongside voice interaction.

## Specification

| Document | Description |
|----------|-------------|
| [`spec/acp-v2.json`](spec/acp-v2.json) | JSON Schema for all ACP message types |
| [`spec/SPEC.md`](spec/SPEC.md) | Formal specification (message lifecycle, error handling, sequencing) |
| [`examples/`](examples/) | Annotated example message exchanges |
| [`conformance/`](conformance/) | Conformance test suite for validating implementations |

## Implementations

| Implementation | Type | Platform | Status |
|---|---|---|---|
| [Vocall Engine](https://primoia.ai) by Primoia | Server | Go | Production |
| [vocall_sdk](https://pub.dev/packages/vocall_sdk) by Primoia | SDK | Flutter | Production |
| [vocall-react](https://primoia.ai) by Primoia | SDK | React / Next.js | Production |
| [`@acprotocol/server`](https://github.com/agent-control-protocol/acp-server) | Server (Reference) | TypeScript | Beta |
| [acp-demo](https://github.com/agent-control-protocol/acp-demo) | Interactive Demo | TypeScript | Beta |

Building an ACP implementation? Open a PR to add it to this table.

## Extensions

The core protocol handles text interaction and UI control. Implementations MAY extend the protocol to support additional modalities such as voice interaction, haptic feedback, or accessibility features. Extensions should be namespaced to avoid conflicts with future protocol versions.

## Community

- [GitHub Discussions](https://github.com/agent-control-protocol/acp/discussions) — Questions, ideas, and general discussion
- [Issue Tracker](https://github.com/agent-control-protocol/acp/issues) — Bug reports and feature requests
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on proposing changes, reporting issues, and submitting implementations.

## License

Apache 2.0 -- see [LICENSE](LICENSE) for details.
