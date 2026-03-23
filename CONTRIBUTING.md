# Contributing to ACP

ACP is an open protocol and we welcome contributions from the community. Whether you are fixing a typo, proposing a new action type, or improving the conformance test suite, your input helps make ACP better for everyone.

## How to Propose Changes

1. **Open an issue first.** Before writing any code or spec text, open a GitHub issue describing what you want to change and why. This lets maintainers and the community discuss the proposal before you invest time in a pull request.

2. **Fork and branch.** Fork this repository and create a feature branch from `main`. Use a descriptive branch name such as `spec/add-transfer-action` or `fix/schema-nullable-field`.

3. **Submit a pull request.** Reference the issue number in your PR description. Keep PRs focused on a single change to make review easier.

## Requirements for Spec Changes

Any change to the ACP specification (files under `spec/`) must include:

- **Clear rationale.** Explain the problem the change solves and why the current spec is insufficient. Link to real-world use cases when possible.
- **Backward compatibility analysis.** Describe whether existing ACP-compliant implementations will break, need updates, or remain unaffected. If the change is breaking, explain the migration path.
- **Example payloads.** Provide complete JSON message examples showing the change in context. Include both the request and response sides of the exchange where applicable.

## Conformance Test Requirement

Any pull request that introduces a new message type or action type **must** include corresponding test fixtures in the `conformance/` directory. This ensures that implementations can validate support for the new functionality from day one.

At minimum, provide:

- A JSON Schema addition or update (if the message shape changes).
- One or more fixture files exercising the new type in a realistic exchange sequence.
- Updates to the relevant test script (`test:schema`, `test:handshake`, `test:actions`, or `test:session`) so the new fixture is covered.

## Code Style and Conventions

- Spec documents use Markdown with ATX-style headings (`#`, `##`, etc.).
- JSON examples must be valid JSON (not JSON5 or JSONC). Use 2-space indentation.
- Schema files follow JSON Schema draft 2020-12.
- Commit messages should be concise and imperative (e.g., "Add file-transfer action type" not "Added file transfer stuff").

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to uphold a welcoming, inclusive, and harassment-free environment for everyone.

## Getting Help

If you have questions about the spec, the conformance suite, or anything else related to ACP, head over to [GitHub Discussions](https://github.com/primoia/acp-protocol/discussions). That is the best place for open-ended questions, design ideas, and community conversation.

For bug reports and concrete proposals, use [GitHub Issues](https://github.com/primoia/acp-protocol/issues).

## License

By contributing to this repository, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE).
