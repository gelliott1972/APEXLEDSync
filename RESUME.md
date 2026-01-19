# UniSync - Resume Guide

## Current State (as of 2026-01-19)

### Branch: `main` (merged from feature/appsync-realtime)

### Completed Features
- **ShowSet Locking** - Full implementation complete
  - Auto-locks when drawing2d status = complete
  - Lock/unlock icons in table, kanban, and detail views
  - Admin-only Unlock button with required reason
  - Cascade reset of downstream stages when work starts on unlocked ShowSet
  - StartWorkDialog shows locked message or cascade warning

- **Custom Domain** - apex.wrangleit.net
  - ACM certificate created and validated in us-east-1
  - Route53 A record configured
  - CloudFront distribution updated
  - deploy.bat script in infrastructure/ for manual deployments

- **AppSync GraphQL** - Infrastructure added
  - Schema with subscriptions for real-time updates
  - Apollo Client integration
  - Fixed subscription output type mismatch

- **GitHub Actions CI/CD** - Optimized workflow
  - Path-based detection (skips CDK for frontend-only changes)
  - Fetches Cognito config from CloudFormation (no manual secrets needed)
  - Added --passWithNoTests for vitest
  - Builds shared-types before frontend

### Currently Deploying
GitHub Actions is running. Last push fixed: build shared-types before frontend.

Check status: https://github.com/gelliott1972/APEXLEDSync/actions

### Known Issues

#### Notes Not Saving (Local Dev)
When running `pnpm dev` locally, notes don't save because there's no local backend server.

**Fix:** Create `apps/frontend/.env.local`:
```
VITE_API_URL=https://apex.wrangleit.net/api
```
This points local frontend to deployed AWS backend.

### Key Files Modified This Session
- `apps/frontend/src/components/showset/StartWorkDialog.tsx` - Lock check + warnings
- `apps/frontend/src/components/showset/ShowSetTable.tsx` - Lock icons
- `apps/frontend/src/components/showset/KanbanBoard.tsx` - Lock icons
- `apps/frontend/src/components/showset/UnlockShowSetDialog.tsx` - NEW
- `apps/backend/src/handlers/showsets/index.ts` - Unlock endpoint + cascade logic
- `.github/workflows/deploy.yml` - Optimized CI/CD
- `infrastructure/graphql/schema.graphql` - Fixed subscription types
- `infrastructure/deploy.bat` - Manual deployment script

### AWS Resources
- Certificate ARN: `arn:aws:acm:us-east-1:726966883566:certificate/ce9d9f3d-7dfe-41b8-a04c-812bddaa1977`
- Hosted Zone ID: `Z10166762BQXM65SWNK23`
- AWS Profile: `AdministratorAccess-726966883566`

### Quick Commands
```bash
# Local development (frontend only, uses deployed API)
# First create apps/frontend/.env.local with VITE_API_URL
pnpm dev

# Manual deploy to AWS
cd infrastructure && deploy.bat

# Check GitHub Actions
gh run list --repo gelliott1972/APEXLEDSync
```

---

## Next Steps (if CI passes)
1. Test locking feature on deployed site (apex.wrangleit.net)
2. Test notes functionality on deployed site
3. Consider adding actual test files to frontend/backend
