# ReviewAgent Protocol

Reviewer agent id:

- `019e87d4-83da-7402-84d2-72f43b7c7713`

Rule:

Every completed feature module must be reviewed before work proceeds to the next module.

Review output format:

```text
Verdict: PASS | FAIL
Findings:
- ...
Verification:
- ...
Required fixes:
- ...
```

Blocking policy:

- `PASS`: the next feature may start.
- `FAIL`: all required fixes must be completed, then the same feature must be reviewed again.

Review criteria:

- The feature must build and typecheck.
- The feature must satisfy local free mode: no login or membership gate is allowed.
- UI and interaction should follow the original 王阳 behavior and style for the target module.
- Interactions must be wired to real state or real local functionality where the module claims functionality.
- No static-only placeholder can be marked complete unless documented as intentional and non-blocking.

