# UniSync - Resume Guide

## Current State (as of 2026-01-19)

### Branch: `main`

### What Was Being Fixed
**Deployment failed** - need to check GitHub Actions error and fix.

The last commit `e0f2ef2` added:
1. SQS permission for showsets Lambda to send to translation queue
2. Notes polling while translations pending
3. Cache invalidation for revision notes

### Root Cause Found
The showsets Lambda was missing `sqs:sendmessage` permission to the translation queue. Error in CloudWatch logs:
```
AccessDenied: User is not authorized to perform: sqs:sendmessage on resource: unisync-translation-queue
```

### Fix Applied (in last commit)
`infrastructure/lib/api-stack.ts` line 106:
```typescript
props.translationQueue.grantSendMessages(showSetsHandler); // For revision notes
```

### Issues Being Fixed This Session
1. **Revision notes not appearing in Notes section** - FIXED (backend now creates note in Notes table)
2. **Notes throbbing forever** - Translation queue permission missing (fix deployed but failed)
3. **Notes not refreshing** - Added polling for pending translations
4. **Unlocked ShowSet stages not available** - FIXED in StartWorkDialog.tsx
5. **Version increment not working on unlocked ShowSets** - FIXED in StartWorkDialog.tsx

### Files Modified This Session
- `apps/backend/src/handlers/showsets/index.ts` - Added createRevisionNote function
- `apps/frontend/src/components/showset/ShowSetDetail.tsx` - Added notes polling + cache invalidation
- `apps/frontend/src/components/showset/StartWorkDialog.tsx` - Fixed unlocked ShowSet handling
- `infrastructure/lib/api-stack.ts` - Added SQS permission for showsets Lambda
- `apps/frontend/.env.local` - Points local frontend to deployed API

### Next Steps
1. Check GitHub Actions failure and fix
2. Redeploy
3. Test revision notes + translations working

### AWS Resources
- Certificate ARN: `arn:aws:acm:us-east-1:726966883566:certificate/ce9d9f3d-7dfe-41b8-a04c-812bddaa1977`
- Hosted Zone ID: `Z10166762BQXM65SWNK23`
- AWS Profile: `AdministratorAccess-726966883566`
- Translation Queue: `https://sqs.ap-east-1.amazonaws.com/726966883566/unisync-translation-queue`

### Quick Commands
```bash
# Check GitHub Actions
gh run list --repo gelliott1972/APEXLEDSync

# Check Lambda logs
MSYS_NO_PATHCONV=1 aws logs filter-log-events --log-group-name "/aws/lambda/unisync-showsets" --filter-pattern "ERROR" --profile AdministratorAccess-726966883566 --region ap-east-1

# Check SQS queue
aws sqs get-queue-attributes --queue-url "https://sqs.ap-east-1.amazonaws.com/726966883566/unisync-translation-queue" --attribute-names ApproximateNumberOfMessages --profile AdministratorAccess-726966883566 --region ap-east-1
```

### Test Accounts
| Email | Password | Role |
|-------|----------|------|
| grant@candelic.com | Password1234 | Admin |
| modeller@test.local | TestPass123 | 3D Modeller |
