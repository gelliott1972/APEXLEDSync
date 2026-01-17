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
- **Roles**: admin, bim_coordinator, 3d_modeller, 2d_drafter

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
