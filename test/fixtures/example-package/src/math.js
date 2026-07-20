/** Adds two numbers. */
export function add(a, b) {
  function normalize(value) {
    return Number(value);
  }
  return normalize(a) + normalize(b);
}

/** Performs calculations. */
export class Calculator {
  /** Subtracts two numbers. */
  Subtract(a, b) {
    return a - b;
  }
}
