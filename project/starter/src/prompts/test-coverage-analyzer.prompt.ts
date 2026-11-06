export const TEST_COVERAGE_ANALYZER_PROMPT = `Analyze the provided source file and related tests.

Identify:
- Existing test files
- Untested functions and classes
- Untested branches
- Missing edge cases
- High-risk scenarios requiring tests

For every missing test, provide its type, location, priority, reasoning, and a suggested test case.

Provide a realistic coverage estimate from 0 to 100.`;