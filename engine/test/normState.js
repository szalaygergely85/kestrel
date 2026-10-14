// QFIX-S6b: content entities keep their saved ground-snapped z when x/y are unchanged, so round trips are exact again.
// Kept as an identity hook so the test imports stay valid.
export function normState(s) { return s; }
