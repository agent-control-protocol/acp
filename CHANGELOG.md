# Changelog

All notable changes to the ACP specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-03-27

### Changed

- **Reduced UI actions from 14 to 8**: Removed `highlight`, `focus`, `scroll_to`, `enable`, `disable`, `select`. Renamed `fill` → `set_field` (absorbs `select`).
- **Unified streaming**: Merged `chat_token` into `chat` message type with `delta: boolean` property. Streaming tokens are now `{ type: 'chat', from: 'agent', message: '...', delta: true }`.
- **Removed animation from protocol**: Removed `animate` and `speed` properties from UIAction (presentation concern for SDK layer). Kept `duration` for `show_toast`.

### Removed

- `ChatTokenMessage` server message type (replaced by `chat` with `delta: true`)
- `AnimationType` enum (`typewriter`, `count_up`, `fade_in`, `none`)
- 6 UI actions: `highlight`, `focus`, `scroll_to`, `enable`, `disable`, `select`
- `animate` and `speed` properties from UIAction

## [1.0.0] - 2026-03-23

### Added

- ACP v1 JSON Schema (`spec/acp-v1.json`) with JSON Schema draft 2020-12
- Formal specification (`spec/SPEC.md`) — 1500+ lines, RFC-style
- 14 UI actions: navigate, fill, clear, select, click, highlight, focus, scroll_to, show_toast, ask_confirm, open_modal, close_modal, enable, disable
- 15 field types: text, number, currency, date, datetime, email, phone, masked, select, autocomplete, checkbox, radio, textarea, file, hidden
- 7 client message types: manifest, text, state, result, confirm, llm_config, response_lang_config
- 6 server message types: config, command, chat, chat_token, status, error
- 5 annotated example exchanges (`examples/`)
- Conformance test suite with 6 golden fixtures (`conformance/`)
- Landing page for acp-protocol.org (`site/`)
- Apache 2.0 license
