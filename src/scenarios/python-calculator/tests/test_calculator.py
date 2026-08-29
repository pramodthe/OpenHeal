import unittest
from calculator.calculator import Calculator

class TestCalculator(unittest.TestCase):
    def setUp(self):
        self.calc = Calculator()

    def test_add(self):
        self.assertEqual(self.calc.add(2, 3), 5.0)
        self.assertEqual(self.calc.add(-1, 1), 0.0)

    def test_subtract(self):
        self.assertEqual(self.calc.subtract(10, 4), 6.0)
        self.assertEqual(self.calc.subtract(0, 5), -5.0)

    def test_multiply(self):
        self.assertEqual(self.calc.multiply(3, 4), 12.0)
        self.assertEqual(self.calc.multiply(-2, 3), -6.0)

    def test_division_precision(self):
        # Fails when integer division is used: 7 // 2 = 3 != 3.5
        self.assertEqual(self.calc.divide(7, 2), 3.5)
        self.assertEqual(self.calc.divide(1, 4), 0.25)

    def test_division_by_zero(self):
        with self.assertRaises(ValueError):
            self.calc.divide(10, 0)

if __name__ == '__main__':
    unittest.main()

