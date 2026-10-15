## What

## Why

## How it was tested

## Security checklist
- [ ] No secrets, tokens, real personal data, real domains or real transactions (fixtures are fake)
- [ ] New input is validated with zod; new tools declare `readOnly` / `destructive` and bilingual descriptions
- [ ] No tool sends data outward (no email sending, no arbitrary URL fetch)
- [ ] `src/core`, `src/modules`, `src/auth`, `src/http` do not import `node:*`
- [ ] New dependency? Explain why it is needed
