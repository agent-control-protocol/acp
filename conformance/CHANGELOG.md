# Changelog

All notable changes to `@acprotocol/conformance` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.0.2] - 2026-05-12

### Added

- Bin alias `conformance` (in addition to `acp-conformance`) so `npx -p @acprotocol/conformance conformance ws://...` works without remembering the longer name.

### Fixed

- Normalized `repository.url` to `git+https://...` form (`npm pkg fix`).

## [2.0.1] - 2026-05-12

### Changed

- Renamed package from `@acp-protocol/conformance` to `@acprotocol/conformance` for consistency with `@acprotocol/server`.
- Aligned test suite with the 8-verb UI action schema (`navigate`, `set_field`, `clear`, `click`, `show_toast`, `ask_confirm`, `open_modal`, `close_modal`).
- Updated full-session test to use the unified `chat` streaming model (with `delta` / `final`) instead of the retired `chat_token` type.

### Fixed

- Removed stale assertions that referenced retired verbs (`fill`, `select`, `scroll_to`, `focus`, `highlight`, `enable`, `disable`) and animation properties (`typewriter`, `count_up`).
- Adjusted message-type count expectation to reflect the current schema (5 server types).

### Added

- `publishConfig.access: public` so scoped publishes do not require manual `--access public` flag.
- `files` whitelist (`bin`, `lib`, `fixtures`, `README.md`) to prevent shipping `tests/`, `scripts/`, or `node_modules/`.
- `author`, `homepage`, `bugs` metadata aligned with `@acprotocol/server`.

## [2.0.0] - 2026-03-28

- Initial public conformance suite covering ACP v2 schema. (Not published to npm.)
