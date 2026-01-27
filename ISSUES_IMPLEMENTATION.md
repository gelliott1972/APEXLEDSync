# Notes to Issues Conversion - Implementation Status

## Branch
`feature/notes-to-issues`

## Summary
Transforming the flat Notes feature into a full-featured Issues system with threading, status management, and user mentions.

---

## COMPLETED WORK

### 1. Shared Types (`packages/shared-types/src/issue.ts`) ✅
New file with:
- `IssueStatus` ('open' | 'closed')
- `IssueMention` (userId, userName)
- `Issue` interface (extends Note with: parentIssueId, replyCount, status, closedAt, closedBy, closedByName, mentions)
- `IssueCreateInput`, `IssueUpdateInput`
- `IssueDDBKeys`, `IssueAuthorGSI`, `IssueMentionGSI`
- `MyIssuesResponse`

Updated `packages/shared-types/src/index.ts` to export all new types.

### 2. Database Utils (`packages/db-utils/src/index.ts`) ✅
Added:
- `GSI_NAMES.ISSUE_AUTHOR_INDEX` = 'GSI1-author-index'
- `GSI_NAMES.ISSUE_MENTION_INDEX` = 'GSI2-mention-index'
- `keys.issue(showSetId, timestamp, issueId)`
- `keys.issueAuthor(userId, timestamp, issueId)`
- `keys.issueMention(userId, showSetId, timestamp, issueId)`

### 3. Database Stack (`infrastructure/lib/database-stack.ts`) ✅
Added two GSIs to `unisync-notes` table:
```typescript
// GSI1 for author lookup ("My Issues")
indexName: 'GSI1-author-index'
partitionKey: GSI1PK (STRING)
sortKey: GSI1SK (STRING)

// GSI2 for mention lookup
indexName: 'GSI2-mention-index'
partitionKey: GSI2PK (STRING)
sortKey: GSI2SK (STRING)
```

### 4. Authorization Middleware (`apps/backend/src/middleware/authorize.ts`) ✅
Added functions:
- `canCreateIssue(role)` - all except view_only
- `canEditIssue(authorId, userId)` - author only
- `canDeleteIssue(role, authorId, userId)` - author or admin
- `canCloseIssue(role, authorId, userId)` - author or admin

### 5. Issues Handler (`apps/backend/src/handlers/issues/index.ts`) ✅
New file with endpoints:
- `GET /showsets/{id}/issues` - list issues for ShowSet
- `POST /showsets/{id}/issues` - create issue
- `GET /issues/{issueId}` - get issue with replies
- `PUT /issues/{issueId}` - update issue
- `DELETE /issues/{issueId}` - delete issue
- `POST /issues/{issueId}/replies` - add reply
- `POST /issues/{issueId}/close` - close issue
- `POST /issues/{issueId}/reopen` - reopen issue
- `GET /issues/my-issues` - get my issues + badge count
- Attachment endpoints (presign, confirm, get, delete)

Features:
- Backward compatible: reads legacy NOTE# items as issues
- @mention parsing from content
- Translation queue integration
- Activity logging

### 6. API Stack (`infrastructure/lib/api-stack.ts`) ✅
Added:
- `issuesHandler` Lambda creation with permissions
- `issuesIntegration` for API Gateway
- All issue routes registered

### 7. Backend Build (`apps/backend/build.js`) ✅
Added `'issues'` to handlers array.

### 8. Frontend API Client (`apps/frontend/src/lib/api.ts`) ✅
Added `issuesApi` object with all methods:
- list, get, create, createReply, update, delete
- close, reopen, myIssues
- presignUpload, confirmUpload, getAttachment, deleteAttachment, uploadFile

### 9. Frontend Components (`apps/frontend/src/components/issues/`) ✅
Created:
- `IssueStatusBadge.tsx` - Open/Closed badge
- `IssueItem.tsx` - Issue card with status, mentions, attachments, close/reopen
- `CreateIssueForm.tsx` - New issue form with @mention autocomplete
- `IssueListView.tsx` - Filterable list with status filter
- `IssueDetailView.tsx` - Thread view with replies
- `IssuesModal.tsx` - Main modal with tabs (Created by Me / Mentioned In)
- `index.ts` - Barrel export

### 10. UI Component: Tabs (`apps/frontend/src/components/ui/tabs.tsx`) ✅
Created shadcn/ui Tabs component using @radix-ui/react-tabs.

### 11. Header Badge (`apps/frontend/src/components/layout/Header.tsx`) ✅
Added:
- Import for `useQuery`, `issuesApi`, `MessageSquare`, `IssuesModal`
- `myIssues` query with 60s polling
- Issues button with badge count (between theme toggle and language selector)
- IssuesModal component

### 12. ShowSetDetail (`apps/frontend/src/components/showset/ShowSetDetail.tsx`) ✅
Changed:
- Import `issuesApi` instead of `notesApi`
- Import `IssuesModal`, `IssueItem`, `CreateIssueForm`
- Query changed from notes to issues
- Replaced Notes section with Issues section:
  - Collapsible header with open count
  - "View All" button opens IssuesModal
  - Inline CreateIssueForm
  - Compact IssueItem list (max 3, then "view all" link)

### 13. Translations ✅
Added `issues` section to:
- `apps/frontend/src/locales/en.json`
- `apps/frontend/src/locales/zh.json`
- `apps/frontend/src/locales/zh-TW.json`

Keys: title, myIssues, allIssues, createdByMe, mentionedIn, createIssue, noIssues, noReplies, replies, reply, addReply, viewAll, open, closed, close, reopen, closedBy, filterOpen, filterClosed, filterAll, mentionUser, translating, translationFailed, attachFile, uploading, uploadFailed, invalidFileType, fileTooLarge, showSetIssues, backToList, openIssues

### 14. GitHub Workflow (`.github/workflows/deploy-test.yml`) ✅
Created build & test workflow for feature branches (doesn't deploy to test environment yet).

---

## BUILD STATUS ✅
```bash
pnpm build  # Passes successfully
```
- All TypeScript compiles
- Backend builds all handlers including `issues`
- Frontend builds with no errors

---

## REMAINING WORK

### Deployment (Not Started)
1. **Deploy Database GSIs**
   - Run CDK to add GSI1 and GSI2 to notes table
   - Wait for GSI backfill to complete

2. **Deploy Backend**
   - Deploy issues Lambda
   - Update API Gateway with new routes

3. **Deploy Frontend**
   - Can use existing branch-based deployment pattern

### Testing Needed
- [ ] Create issue, verify appears in list
- [ ] Add reply, verify threading works
- [ ] @mention user, verify badge count for mentioned user
- [ ] Close/reopen issue, verify status updates
- [ ] Verify existing notes appear as open issues
- [ ] Test all user roles for correct permissions
- [ ] Test attachments on issues

### Optional Enhancements (Not in Scope)
- Email/toast notifications for mentions
- Issue search/filtering by date
- Issue assignment to users

---

## DEPLOYMENT INSTRUCTIONS

### Option A: Full CDK Deploy (Recommended)
```bash
cd /mnt/e/code/APEXLEDSync/infrastructure
npx cdk deploy UnisyncDatabaseStack UnisyncApiStack --require-approval never
```
This will:
1. Add GSIs to notes table
2. Create issues Lambda
3. Update API Gateway

### Option B: Manual Steps
1. **Add GSIs via AWS Console:**
   - Go to DynamoDB → unisync-notes → Indexes
   - Create GSI1-author-index (PK: GSI1PK, SK: GSI1SK)
   - Create GSI2-mention-index (PK: GSI2PK, SK: GSI2SK)
   - Wait for ACTIVE status

2. **Deploy Lambda:**
   ```bash
   cd /mnt/e/code/APEXLEDSync
   pnpm --filter backend build
   # Zip and upload apps/backend/dist/handlers/issues/ to AWS Lambda
   ```

3. **Update API Gateway:**
   - Add routes manually or redeploy via CDK

### Frontend Deployment
Use existing branch-based pattern:
```
feature-notes-to-issues.apex.wrangleit.net
```

---

## KEY FILES REFERENCE

| File | Purpose |
|------|---------|
| `packages/shared-types/src/issue.ts` | Issue type definitions |
| `packages/db-utils/src/index.ts` | GSI names and key builders |
| `infrastructure/lib/database-stack.ts` | GSI definitions |
| `infrastructure/lib/api-stack.ts` | Issues Lambda and routes |
| `apps/backend/src/handlers/issues/index.ts` | All issue endpoints |
| `apps/backend/src/middleware/authorize.ts` | Permission helpers |
| `apps/frontend/src/lib/api.ts` | issuesApi client |
| `apps/frontend/src/components/issues/` | All UI components |
| `apps/frontend/src/components/layout/Header.tsx` | Badge in header |
| `apps/frontend/src/components/showset/ShowSetDetail.tsx` | Issues in sidebar |
| `apps/frontend/src/locales/*.json` | Translations |

---

## BACKWARD COMPATIBILITY

The implementation maintains full backward compatibility:
- Existing `/notes/*` API endpoints unchanged
- Legacy `NOTE#` items in DynamoDB read as issues with defaults:
  - `status: 'open'`
  - `mentions: []`
  - `replyCount: 0`
- No data migration required - happens on read

---

## RESUME INSTRUCTIONS

To continue this work after context reset:

1. Read this file: `ISSUES_IMPLEMENTATION.md`
2. Branch is `feature/notes-to-issues`
3. All code is complete and builds
4. Next step: Deploy backend (CDK or manual)
5. Then: Deploy frontend to test URL
6. Then: Test functionality
7. Finally: Merge to main for production
