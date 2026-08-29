# Rust Parser Scenario

A broken Rust tokenizer/parser crate for OpenHeal self-healing demonstration.

## Failure Description
In `src/parser.rs`, the string literal tokenizer in `tokenize()` fails to handle escaped quote sequences (`\"`), terminating strings prematurely and corrupting subsequent token stream offsets.

## Running Tests
```bash
cargo test
```
