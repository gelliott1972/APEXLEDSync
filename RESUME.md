# UniSync - Resume Guide

## Current State (as of 2026-01-19)

### Branch: `main`

### Critical Issues After Latest Deployment

1. **Can't log on** - Authentication broken after custom domain deployment
   - Likely cause: Cognito callback URLs not updated for apex.wrangleit.net
   - Or: CloudFront/Route53 configuration issue

2. **Notes still throbbing** - Translation not completing
   - SQS permission was added but may not have deployed correctly
   - Check CloudWatch logs for showsets Lambda errors

### Recent Commits (newest first)
- `b03c679` - Disable mutation retries to prevent duplicate notes
- `955fff6` - Add custom domain configuration to CDK deploy
- `b408bc1` - Fix TypeScript errors in refetchInterval callback
- `e0f2ef2` - Fix revision notes: add SQS permissions and improve polling

### Custom Domain Configuration Added
`.github/workflows/deploy.yml` now passes to CDK deploy:
```yaml
env:
  DOMAIN_NAME: apex.wrangleit.net
  CERTIFICATE_ARN: arn:aws:acm:us-east-1:726966883566:certificate/ce9d9f3d-7dfe-41b8-a04c-812bddaa1977
  HOSTED_ZONE_ID: Z10166762BQXM65SWNK23
```

### What Was Working Before Domain Change
- Site accessible at CloudFront URL: https://d1pk68b7wm6j8t.cloudfront.net
- Authentication working
- Revision notes appearing in Notes section (but duplicated - fixed with mutation retry change)

### Debugging Steps for Login Issue

1. **Check if site loads at CloudFront URL** (bypasses custom domain):
   ```
   https://d1pk68b7wm6j8t.cloudfront.net
   ```

2. **Check Route53 for A record**:
   ```bash
   MSYS_NO_PATHCONV=1 aws route53 list-resource-record-sets --hosted-zone-id Z10166762BQXM65SWNK23 --profile AdministratorAccess-726966883566
   ```

3. **Check Cognito callback URLs** - may need to add apex.wrangleit.net:
   ```bash
   MSYS_NO_PATHCONV=1 aws cognito-idp describe-user-pool-client --user-pool-id ap-east-1_lwucN8Mwv --client-id br8fm8v29378p5tfjfh0r0004 --profile AdministratorAccess-726966883566 --region ap-east-1
   ```

4. **Check CloudWatch logs for errors**:
   ```bash
   MSYS_NO_PATHCONV=1 aws logs filter-log-events --log-group-name "/aws/lambda/unisync-showsets" --filter-pattern "ERROR" --profile AdministratorAccess-726966883566 --region ap-east-1 --limit 20
   ```

### Debugging Steps for Throbbing Notes

1. **Check if SQS permission was applied**:
   ```bash
   MSYS_NO_PATHCONV=1 aws lambda get-policy --function-name unisync-showsets --profile AdministratorAccess-726966883566 --region ap-east-1
   ```

2. **Check SQS queue for messages**:
   ```bash
   aws sqs get-queue-attributes --queue-url "https://sqs.ap-east-1.amazonaws.com/726966883566/unisync-translation-queue" --attribute-names All --profile AdministratorAccess-726966883566 --region ap-east-1
   ```

3. **Check translate Lambda logs**:
   ```bash
   MSYS_NO_PATHCONV=1 aws logs filter-log-events --log-group-name "/aws/lambda/unisync-translate" --profile AdministratorAccess-726966883566 --region ap-east-1 --limit 20
   ```

### Files Modified This Session
- `apps/frontend/src/lib/query-client.ts` - Disabled mutation retries
- `apps/frontend/src/components/showset/ShowSetDetail.tsx` - Fixed TypeScript errors, added notes polling
- `.github/workflows/deploy.yml` - Added custom domain env vars
- `infrastructure/lib/api-stack.ts` - Added SQS permission for showsets Lambda

### AWS Resources
- Certificate ARN: `arn:aws:acm:us-east-1:726966883566:certificate/ce9d9f3d-7dfe-41b8-a04c-812bddaa1977`
- Hosted Zone ID: `Z10166762BQXM65SWNK23`
- AWS Profile: `AdministratorAccess-726966883566`
- Translation Queue: `https://sqs.ap-east-1.amazonaws.com/726966883566/unisync-translation-queue`
- CloudFront Distribution: `E2CR5CE50E5ZPM` (d1pk68b7wm6j8t.cloudfront.net)
- User Pool ID: `ap-east-1_lwucN8Mwv`
- User Pool Client ID: `br8fm8v29378p5tfjfh0r0004`

### Test Accounts
| Email | Password | Role |
|-------|----------|------|
| grant@candelic.com | Password1234 | Admin |
| modeller@test.local | TestPass123 | 3D Modeller |

### Local Development
`.env.local` in `apps/frontend/`:
```
VITE_API_URL=https://oqgjknhxp7.execute-api.ap-east-1.amazonaws.com/v1
VITE_USER_POOL_ID=ap-east-1_lwucN8Mwv
VITE_USER_POOL_CLIENT_ID=br8fm8v29378p5tfjfh0r0004
```
