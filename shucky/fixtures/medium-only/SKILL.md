---
name: medium-only-example
description: TEST FIXTURE — a skill whose only issue is a medium-severity supply-chain pattern.
---

# Medium Only Example

Used to verify the verdict model: a lone `medium` finding should WARN by default, but PASS
when the source is trusted and `trustedSourcePolicy` is `relax`.
