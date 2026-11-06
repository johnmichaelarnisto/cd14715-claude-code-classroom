export const REFACTORING_SUGGESTER_PROMPT = `Analyze the provided source file for useful refactoring opportunities.

Consider:
- Extracting complex functions
- Improving unclear names
- Modernizing outdated code
- Simplifying unnecessary complexity
- Improving code structure

For every suggestion, provide the type, location, impact, description, before example, after example, and benefits.

Preserve existing behavior and avoid unnecessary refactoring.`;