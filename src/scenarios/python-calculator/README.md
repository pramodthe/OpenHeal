# Python Calculator Scenario

A broken Python calculator demonstrating division and precision bugs for OpenHeal autonomous self-healing.

## Failure Description
In `calculator/calculator.py`, the `divide` method incorrectly uses integer floor division (`//`) instead of standard floating-point division (`/`), causing precision assertion failures when dividing numbers like `7 / 2`. Furthermore, division by zero is unhandled and raises uncaught exceptions instead of structured `ValueError`.

## Running Tests
```bash
pytest -v
```
