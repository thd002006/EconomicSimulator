## Complexity

Do not add files, helpers, layers, or dependencies unless the current
change has no honest home in existing code. Three similar lines beat
a premature abstraction. Never design for hypothetical future
requirements. Never introduce a second way to do something the repo
already does — extend the existing function.

Match local patterns even if a textbook architecture is "cleaner".
If you wrote a Service/Helper/Util/Manager that has one call site,
inline it before you finish. If a change can be a deletion, delete.

Do not add error handling for states the type system or framework
already makes impossible. Do not add comments that restate the code.
Do not add feature flags or back-compat shims for APIs that never
shipped.