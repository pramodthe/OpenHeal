"""
Calculator module with mathematical operations.
Contains intentional bug in division operation for self-healing demonstration.
"""

class Calculator:
    def add(self, a: float, b: float) -> float:
        return a + b

    def subtract(self, a: float, b: float) -> float:
        return a - b

    def multiply(self, a: float, b: float) -> float:
        return a * b

    def divide(self, a: float, b: float) -> float:
        # BUG: Uses integer division instead of float division and doesn't handle division by zero
        return a // b
