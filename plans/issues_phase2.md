# Issues Implementation - Phase 2

## Branch: `feature/notes-to-issues`

## Status: COMPLETE

---

## Overview

This phase focused on fixing UX issues with the Issues system:
1. Add outstanding issues badge to speech bubble in ShowSet table
2. Speech bubble click should directly open Issues modal (not detail panel)
3. Fix duplicate "Back to List" buttons in issue thread modal
4. Remove tabs from single issue thread view
5. Fix reply bug - replies are not being added to threads

---

## Tasks

### 1. Backend: Fix Reply Bug
**Status**: [x] DONE

**Problem**: When creating a reply via `POST /issues/{issueId}/replies`, the `parentIssueId` was not being set correctly.

**Root Cause** (`apps/backend/src/handlers/issues/index.ts:999-1006`):
The code overwrote `event.pathParameters` before reading `issueId` from it, so `parentIssueId` became `undefined`.

**Fix Applied**: Saved the issueId before overwriting pathParameters:
```javascript
case 'POST /issues/{issueId}/replies':
  const issueIdForReply = event.pathParameters?.issueId;  // Save first
  event.pathParameters = { id: event.queryStringParameters?.showSetId };
  const body = JSON.parse(event.body ?? '{}');
  body.parentIssueId = issueIdForReply;  // Use saved value
  event.body = JSON.stringify(body);
  return await wrappedHandler(createIssue);
```

**Files Modified**: `apps/backend/src/handlers/issues/index.ts`

---

### 2. Frontend: Remove Duplicate "Back to List" Button
**Status**: [x] DONE

**Problem**: Two "Back to list" buttons appeared when viewing a single issue thread.

**Fix Applied**: Removed the back button from `IssueDetailView.tsx` since `IssuesModal.tsx` already manages navigation. Also removed the `onBack` prop since it's no longer needed.

**Files Modified**:
- `apps/frontend/src/components/issues/IssueDetailView.tsx`
- `apps/frontend/src/components/issues/IssuesModal.tsx`

---

### 3. Frontend: Hide Tabs in Single Issue View
**Status**: [x] DONE

**Problem**: Tabs (All Issues, Created by Me, Mentioned In) were visible when viewing a single issue thread.

**Fix Applied**: Wrapped `TabsList` in a conditional render that hides it when `selectedIssue` is not null.

**Files Modified**: `apps/frontend/src/components/issues/IssuesModal.tsx`

---

### 4. Frontend: Add Outstanding Issues Badge to Speech Bubble
**Status**: [x] DONE

**Problem**: No visual indicator of open issues count on the speech bubble icon in ShowSet table.

**Solution Applied**:
- Added `issueCounts?: Record<string, number>` prop to `ShowSetTable`
- Dashboard queries issues for all visible ShowSets using `useQueries`
- Computes open issue counts (excluding replies) per ShowSet
- Renders a small red badge with the count on the MessageSquare button (only when count > 0)

**Files Modified**:
- `apps/frontend/src/components/showset/ShowSetTable.tsx`
- `apps/frontend/src/pages/Dashboard.tsx`

---

### 5. Frontend: Speech Bubble Opens Issues Modal Directly
**Status**: [x] DONE

**Problem**: Clicking speech bubble opened ShowSetDetail panel. User wanted it to directly open the IssuesModal.

**Solution Applied**:
- Changed `onSelectNotes` to `onOpenIssuesModal(showSetId, showSetName)` in ShowSetTable
- Added IssuesModal state management in Dashboard
- Rendered IssuesModal component in Dashboard
- Speech bubble now opens the full IssuesModal with all tabs

**Files Modified**:
- `apps/frontend/src/components/showset/ShowSetTable.tsx`
- `apps/frontend/src/pages/Dashboard.tsx`

---

## Translation Updates

Added `issues.viewIssues` translation key:
- en: "View Issues"
- zh: "查看问题"
- zh-TW: "檢視問題"

**Files Modified**:
- `apps/frontend/src/locales/en.json`
- `apps/frontend/src/locales/zh.json`
- `apps/frontend/src/locales/zh-TW.json`

---

## Testing Checklist

- [x] Build passes (`pnpm build`)
- [ ] Create a new issue - should appear in list
- [ ] Reply to an issue - should appear as a reply, NOT as a new issue
- [ ] View issue thread - should show only ONE "Back to list" button
- [ ] View issue thread - should NOT show tabs (All Issues, Created by Me, etc.)
- [ ] ShowSet table - speech bubble should show badge with open issue count
- [ ] Click speech bubble - should open Issues modal directly (not side panel)

---

## Session Log

### 2026-01-28
- Analyzed Phase 2 requirements
- Identified root cause of reply bug (backend)
- Implemented all 5 fixes
- Added translation keys
- Build verified successful
- All tasks completed
