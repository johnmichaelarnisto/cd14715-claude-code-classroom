export const CODE_QUALITY_ANALYZER_PROMPT = `Analyze the provided source file for code quality.

Check for:
- Security vulnerabilities
- Performance problems
- Maintainability issues
- Style problems
- Bug risks
- Best-practice violations

For each issue, provide the line, severity, category, description, and suggestion.

Do not invent issues that are not supported by the code.`;