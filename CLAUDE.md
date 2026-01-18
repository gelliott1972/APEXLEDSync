# UniSync - BIM Coordination Board

BIM model tracking app for LED screen ShowSets through a 6-stage pipeline.

## Quick Start

```bash
pnpm install
pnpm dev                    # Start frontend + backend
docker-compose up -d        # LocalStack for local DynamoDB
```

## Structure

```
apps/
  frontend/     # React + Vite + shadcn/ui
  backend/      # Lambda handlers (ESM, Node 22)
packages/
  shared-types/ # TypeScript types
  db-utils/     # DynamoDB helpers
infrastructure/ # AWS CDK stacks
```

## Key Commands

```bash
pnpm build                  # Build all
pnpm test                   # Run tests
pnpm --filter frontend dev  # Frontend only
pnpm --filter backend build # Build Lambdas
pnpm cdk:deploy             # Deploy to AWS (uses SSO profile)
```

## AWS Deployment

Uses SSO profile `AdministratorAccess-726966883566`. All resources prefixed with `unisync-`.

## Data Model

- **ShowSets**: 6-stage pipeline (screen → structure → integrated → inBim360 → awaitingClient → drawing2d)
- **Areas**: 311 (Attraction Tower), 312 (Marvel Plaza)
- **Roles**: admin, bim_coordinator, engineer, 3d_modeller, 2d_drafter

## Role Permissions

| Action | Admin | BIM Coord | Engineer | 3D Modeller | 2D Drafter |
|--------|-------|-----------|----------|-------------|------------|
| Access Admin page | ✓ | | | | |
| Create/delete ShowSets | ✓ | | | | |
| Update Screen/Structure/Integrated | ✓ | | ✓* | ✓ | |
| Update In BIM360 | ✓ | ✓ | ✓* | | |
| Update 2D Drawing | ✓ | | ✓* | | ✓ |
| Manage links | ✓ | ✓ | | | |
| Add/edit own notes | ✓ | ✓ | ✓ | ✓ | ✓ |
| Delete any notes | ✓ | | | | |
| Manage users | ✓ | | | | |

*Engineer can only set status to "Complete" or "Revision Required" (approval-only)

## Test Accounts

| Email | Password | Role |
|-------|----------|------|
| grant@candelic.com | Password1234 | Admin |
| admin@test.local | TestPass123 | Admin |
| bim@test.local | TestPass123 | BIM Coordinator |
| engineer@test.local | TestPass123 | Engineer |
| modeller@test.local | TestPass123 | 3D Modeller |
| drafter@test.local | TestPass123 | 2D Drafter |

## Testing

Test plan and Playwright tests are in `scratch/unisync-tests/`. Run with:
```bash
cd scratch/unisync-tests
pnpm install
pnpm test
```

## API Patterns

- All handlers in `apps/backend/src/handlers/`
- Response helpers in `apps/backend/src/lib/response.ts`
- Auth context extraction in `apps/backend/src/lib/auth.ts`
- Role-based permissions in `apps/backend/src/middleware/authorize.ts`

## Frontend Patterns

- TanStack Query for server state (60s polling)
- Zustand for UI state (filters, views)
- react-i18next for i18n (en, zh, zh-TW)
- shadcn/ui components in `src/components/ui/`

## Tailwind v4 Dark Mode

This project uses Tailwind v4 with `@import "tailwindcss"`. The `dark:` variant does NOT work reliably with utility classes like `dark:text-white`.

**Do NOT use**: `dark:text-white`, `dark:bg-*`, etc. in component classes

**Instead**: Define custom CSS classes in `src/index.css` using the `.dark` selector:

```css
.dark .my-text {
  color: white !important;
}

.my-text {
  color: black;
}
```

See `kanban-text` class in `index.css` as an example.
