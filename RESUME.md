# UniSync - Resume Guide

## How to Resume This Session on Another Machine

### 1. Clone the Repository
```bash
git clone git@github.com:gelliott1972/APEXLEDSync.git unisync
cd unisync
git checkout feature/appsync-realtime
pnpm install
```

### 2. Tell Claude Code to Resume
Say: **"Let's resume from RESUME.md - start with the deployment fixes"**

---

## Current State (as of 2026-01-19)

### Branch: `feature/appsync-realtime`
- AppSync GraphQL infrastructure added
- Apollo Client with subscriptions
- Data hooks created
- NOT YET: ShowSet locking feature

### Pending Tasks

#### 1. CloudFront Deployment Issues
**Problem:** Deployment to CloudFront isn't working properly

**Likely issues to check:**
- GitHub Actions secrets: `AWS_ROLE_ARN`, `API_URL`
- IAM role permissions for OIDC
- S3 bucket permissions
- CloudFront OAC configuration

**To debug:**
```bash
# Check GitHub Actions runs
gh run list --limit 5

# Check if secrets are set
gh secret list
```

#### 2. GitHub Error Messages
Need to investigate what errors are occurring. Check:
- GitHub Actions workflow runs
- Pull request checks
- Branch protection rules

#### 3. Custom Domain: apex.wrangleit.net
**Requirements:**
- Route53 hosted zone exists for wrangleit.net
- Need ACM certificate in us-east-1 (required for CloudFront)
- CloudFront alias configuration
- Route53 A record pointing to CloudFront

**Implementation steps:**
1. Request ACM certificate for apex.wrangleit.net (MUST be in us-east-1)
2. Validate certificate via DNS
3. Update frontend-stack.ts to add domain alias
4. Add Route53 A record for apex.wrangleit.net → CloudFront

#### 4. ShowSet Locking Feature
See `scratch/PLAN-showset-locking.md` for full details.

**Summary:**
- Auto-lock when drawing2d completes
- Padlock icon (🔒/🔓) on locked ShowSets
- Admin-only "Unlock" button with required reason
- Cascade reset of downstream stages when work restarts

---

## Files to Modify for Custom Domain

### `infrastructure/lib/frontend-stack.ts`
Add:
- Certificate import/creation
- CloudFront domain alias
- Route53 A record

### Example changes needed:
```typescript
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

// In FrontendStackProps
domainName?: string;  // apex.wrangleit.net
hostedZoneId?: string;
certificateArn?: string;  // ACM cert ARN in us-east-1

// In constructor - update distribution with:
domainNames: props.domainName ? [props.domainName] : undefined,
certificate: props.certificateArn
  ? acm.Certificate.fromCertificateArn(this, 'Cert', props.certificateArn)
  : undefined,

// Add Route53 record
if (props.domainName && props.hostedZoneId) {
  const hostedZone = route53.HostedZone.fromHostedZoneAttributes(...);
  new route53.ARecord(this, 'AliasRecord', {
    zone: hostedZone,
    recordName: props.domainName,
    target: route53.RecordTarget.fromAlias(
      new targets.CloudFrontTarget(this.distribution)
    ),
  });
}
```

---

## AWS Resources to Create

1. **ACM Certificate** (us-east-1 region - REQUIRED for CloudFront)
   - Domain: apex.wrangleit.net
   - Validation: DNS validation in Route53

2. **GitHub OIDC Provider** (if not exists)
   - For GitHub Actions to assume AWS role

3. **IAM Role for GitHub Actions**
   - Trust policy for GitHub OIDC
   - Permissions for CDK deploy, S3, CloudFront

---

## Quick Commands

```bash
# Start dev server
pnpm dev

# Build everything
pnpm build

# Deploy to AWS (requires SSO login)
cd infrastructure && npx cdk deploy --all

# Check GitHub Actions status
gh run list --repo gelliott1972/APEXLEDSync
```

---

## Secrets Needed in GitHub

| Secret | Description |
|--------|-------------|
| AWS_ROLE_ARN | IAM role ARN for OIDC authentication |
| API_URL | Backend API URL (from API Gateway) |

---

## Order of Operations

1. **Fix GitHub Actions** - Get CI/CD working
2. **Add custom domain** - apex.wrangleit.net
3. **Implement locking feature** - ShowSet lock/unlock workflow
4. **Test everything** - Playwright tests
