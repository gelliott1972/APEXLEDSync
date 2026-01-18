# UniSync Data Model

Documentation of DynamoDB table schemas, key structures, and access patterns.

## Table Overview

| Table | Description | TTL |
|-------|-------------|-----|
| `unisync-users` | User profiles and authentication data | No |
| `unisync-showsets` | ShowSet configurations and stage tracking | No |
| `unisync-notes` | Notes/comments on ShowSets | No |
| `unisync-activity` | Audit log of all changes | No |
| `unisync-sessions` | Real-time presence tracking | Yes (`expiresAt`) |

---

## Users Table

**Table Name:** `unisync-users`

### Key Structure

| Key | Pattern | Description |
|-----|---------|-------------|
| PK | `USER#{userId}` | User identifier |
| SK | `PROFILE` | Fixed value for user profile |

### GSI: Email Lookup (`GSI1-email-index`)

| Key | Pattern | Description |
|-----|---------|-------------|
| GSI1PK | `EMAIL#{email}` | User email address |
| GSI1SK | `PROFILE` | Fixed value |

### Attributes

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | String | Yes | Unique user identifier |
| `email` | String | Yes | User email (unique) |
| `name` | String | Yes | Display name |
| `role` | String | Yes | One of: `admin`, `bim_coordinator`, `3d_modeller`, `2d_drafter` |
| `status` | String | Yes | One of: `active`, `deactivated` |
| `preferredLang` | String | Yes | One of: `en`, `zh`, `zh-TW` |
| `cognitoSub` | String | Yes | Cognito user sub (UUID) |
| `canEditVersions` | Boolean | Yes | Permission to modify version numbers |
| `createdAt` | String (ISO8601) | Yes | Creation timestamp |
| `updatedAt` | String (ISO8601) | Yes | Last update timestamp |

### Example Item

```json
{
  "PK": "USER#usr_abc123",
  "SK": "PROFILE",
  "GSI1PK": "EMAIL#john@example.com",
  "GSI1SK": "PROFILE",
  "userId": "usr_abc123",
  "email": "john@example.com",
  "name": "John Smith",
  "role": "bim_coordinator",
  "status": "active",
  "preferredLang": "en",
  "cognitoSub": "550e8400-e29b-41d4-a716-446655440000",
  "canEditVersions": true,
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:00.000Z"
}
```

### Access Patterns

| Pattern | Keys Used | Query |
|---------|-----------|-------|
| Get user by ID | PK, SK | `PK = USER#<userId> AND SK = PROFILE` |
| Get user by email | GSI1PK, GSI1SK | `GSI1PK = EMAIL#<email> AND GSI1SK = PROFILE` |
| List all users | PK begins with | Scan with filter (admin only) |

---

## ShowSets Table

**Table Name:** `unisync-showsets`

### Key Structure

| Key | Pattern | Description |
|-----|---------|-------------|
| PK | `SHOWSET#{showSetId}` | ShowSet identifier |
| SK | `DETAILS` | Fixed value for main record |

### GSI: Area Filter (`GSI1-area-index`)

| Key | Pattern | Description |
|-----|---------|-------------|
| GSI1PK | `AREA#{area}` | Area code (311 or 312) |
| GSI1SK | `SHOWSET#{showSetId}` | ShowSet identifier |

### Attributes

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `showSetId` | String | Yes | Unique ShowSet identifier |
| `area` | String | Yes | Area code: `311` or `312` |
| `scene` | String | Yes | Scene name |
| `description` | Object | Yes | Localized description (see below) |
| `vmList` | Array | Yes | List of VM items |
| `stages` | Object | Yes | Stage tracking (see below) |
| `links` | Object | Yes | External links |
| `screenVersion` | Number | Yes | Current screen version |
| `revitVersion` | Number | Yes | Current Revit version |
| `drawingVersion` | Number | Yes | Current drawing version |
| `versionHistory` | Array | Yes | History of version changes |
| `createdAt` | String (ISO8601) | Yes | Creation timestamp |
| `updatedAt` | String (ISO8601) | Yes | Last update timestamp |

### Nested Objects

**LocalizedString (description):**
```typescript
{
  "en": string,
  "zh": string,
  "zh-TW": string
}
```

**VMItem:**
```typescript
{
  "id": string,
  "name": string (optional)
}
```

**StageInfo:**
```typescript
{
  "status": "not_started" | "in_progress" | "complete" | "on_hold" | "client_review" | "engineer_review" | "revision_required",
  "assignedTo": string (optional),
  "updatedBy": string,
  "updatedAt": string (ISO8601),
  "version": string (optional)
}
```

**ShowSetStages:**
```typescript
{
  "screen": StageInfo,
  "structure": StageInfo,
  "integrated": StageInfo,
  "inBim360": StageInfoSimple,  // No assignedTo or version
  "drawing2d": StageInfo
}
```

**VersionHistoryEntry:**
```typescript
{
  "id": string,
  "versionType": "screenVersion" | "revitVersion" | "drawingVersion",
  "version": number,
  "reason": LocalizedString,
  "createdAt": string (ISO8601),
  "createdBy": string
}
```

### Example Item

```json
{
  "PK": "SHOWSET#SS-311-001",
  "SK": "DETAILS",
  "GSI1PK": "AREA#311",
  "GSI1SK": "SHOWSET#SS-311-001",
  "showSetId": "SS-311-001",
  "area": "311",
  "scene": "Main Entrance",
  "description": {
    "en": "LED screen at main entrance",
    "zh": "主入口LED屏幕",
    "zh-TW": "主入口LED螢幕"
  },
  "vmList": [
    { "id": "VM001", "name": "Primary Display" },
    { "id": "VM002", "name": "Secondary Display" }
  ],
  "stages": {
    "screen": {
      "status": "complete",
      "assignedTo": "usr_abc123",
      "updatedBy": "usr_def456",
      "updatedAt": "2024-01-15T10:00:00.000Z",
      "version": "1.0"
    },
    "structure": {
      "status": "in_progress",
      "assignedTo": "usr_abc123",
      "updatedBy": "usr_def456",
      "updatedAt": "2024-01-16T10:00:00.000Z"
    },
    "integrated": {
      "status": "not_started",
      "updatedBy": "usr_def456",
      "updatedAt": "2024-01-10T10:00:00.000Z"
    },
    "inBim360": {
      "status": "not_started",
      "updatedBy": "usr_def456",
      "updatedAt": "2024-01-10T10:00:00.000Z"
    },
    "drawing2d": {
      "status": "not_started",
      "updatedBy": "usr_def456",
      "updatedAt": "2024-01-10T10:00:00.000Z"
    }
  },
  "links": {
    "modelUrl": "https://bim360.autodesk.com/model/123",
    "drawingsUrl": null
  },
  "screenVersion": 1,
  "revitVersion": 1,
  "drawingVersion": 1,
  "versionHistory": [],
  "createdAt": "2024-01-10T10:00:00.000Z",
  "updatedAt": "2024-01-16T10:00:00.000Z"
}
```

### Access Patterns

| Pattern | Keys Used | Query |
|---------|-----------|-------|
| Get ShowSet by ID | PK, SK | `PK = SHOWSET#<id> AND SK = DETAILS` |
| List ShowSets by area | GSI1PK | `GSI1PK = AREA#<area>` |
| List all ShowSets | Scan | Full table scan |

---

## Notes Table

**Table Name:** `unisync-notes`

### Key Structure

| Key | Pattern | Description |
|-----|---------|-------------|
| PK | `SHOWSET#{showSetId}` | Parent ShowSet |
| SK | `NOTE#{timestamp}#{noteId}` | Note with timestamp for ordering |

### Attributes

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `noteId` | String | Yes | Unique note identifier |
| `showSetId` | String | Yes | Parent ShowSet ID |
| `authorId` | String | Yes | Author's user ID |
| `authorName` | String | Yes | Author's display name |
| `originalLang` | String | Yes | Original language: `en`, `zh`, `zh-TW` |
| `content` | Object | Yes | Localized content |
| `translationStatus` | String | Yes | `pending`, `complete`, `failed` |
| `attachments` | Array | Yes | List of attachments |
| `isRevisionNote` | Boolean | No | True if note is for revision |
| `createdAt` | String (ISO8601) | Yes | Creation timestamp |
| `updatedAt` | String (ISO8601) | Yes | Last update timestamp |

**NoteAttachment:**
```typescript
{
  "id": string,
  "fileName": string,
  "fileSize": number,
  "mimeType": string,
  "s3Key": string,
  "uploadedAt": string (ISO8601)
}
```

### Example Item

```json
{
  "PK": "SHOWSET#SS-311-001",
  "SK": "NOTE#2024-01-15T10:30:00.000Z#note_xyz789",
  "noteId": "note_xyz789",
  "showSetId": "SS-311-001",
  "authorId": "usr_abc123",
  "authorName": "John Smith",
  "originalLang": "en",
  "content": {
    "en": "Please review the screen placement",
    "zh": "请检查屏幕位置",
    "zh-TW": "請檢查螢幕位置"
  },
  "translationStatus": "complete",
  "attachments": [
    {
      "id": "att_001",
      "fileName": "screenshot.png",
      "fileSize": 102400,
      "mimeType": "image/png",
      "s3Key": "notes/note_xyz789/att_001/screenshot.png",
      "uploadedAt": "2024-01-15T10:35:00.000Z"
    }
  ],
  "isRevisionNote": false,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

### Access Patterns

| Pattern | Keys Used | Query |
|---------|-----------|-------|
| Get notes for ShowSet | PK, SK begins with | `PK = SHOWSET#<id> AND SK BEGINS_WITH NOTE#` |
| Get specific note | PK, SK | Full key query |

---

## Activity Table

**Table Name:** `unisync-activity`

### Key Structure

| Key | Pattern | Description |
|-----|---------|-------------|
| PK | `SHOWSET#{showSetId}` | Parent ShowSet |
| SK | `ACTIVITY#{timestamp}#{activityId}` | Activity with timestamp |

### GSI: Recent Activity (`GSI1-date-index`)

| Key | Pattern | Description |
|-----|---------|-------------|
| GSI1PK | `ACTIVITY_DATE#{YYYY-MM-DD}` | Date partition |
| GSI1SK | `{timestamp}#{activityId}` | Timestamp for ordering |

### Attributes

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `activityId` | String | Yes | Unique activity identifier |
| `showSetId` | String | Yes | Related ShowSet ID |
| `userId` | String | Yes | User who performed action |
| `userName` | String | Yes | User's display name |
| `action` | String | Yes | Action type (see below) |
| `details` | Object | Yes | Action-specific details |
| `createdAt` | String (ISO8601) | Yes | When action occurred |

**Action Types:**
- `status_change` - Stage status was updated
- `assignment` - User was assigned/unassigned
- `link_update` - Model or drawings URL changed
- `version_update` - Version number incremented
- `note_added` - New note created
- `showset_created` - ShowSet was created

**Detail Objects by Action:**

```typescript
// status_change
{
  "stage": StageName,
  "from": StageStatus,
  "to": StageStatus
}

// assignment
{
  "stage": StageName,
  "assignedTo": string | null,
  "assignedToName": string (optional)
}

// version_update
{
  "stage": StageName,
  "version": string
}

// link_update
{
  "field": "modelUrl" | "drawingsUrl",
  "value": string | null
}
```

### Example Item

```json
{
  "PK": "SHOWSET#SS-311-001",
  "SK": "ACTIVITY#2024-01-15T10:30:00.000Z#act_001",
  "GSI1PK": "ACTIVITY_DATE#2024-01-15",
  "GSI1SK": "2024-01-15T10:30:00.000Z#act_001",
  "activityId": "act_001",
  "showSetId": "SS-311-001",
  "userId": "usr_abc123",
  "userName": "John Smith",
  "action": "status_change",
  "details": {
    "stage": "screen",
    "from": "in_progress",
    "to": "complete"
  },
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

### Access Patterns

| Pattern | Keys Used | Query |
|---------|-----------|-------|
| Get activity for ShowSet | PK, SK begins with | `PK = SHOWSET#<id> AND SK BEGINS_WITH ACTIVITY#` |
| Get recent activity (global) | GSI1 | `GSI1PK = ACTIVITY_DATE#<date>` |
| Get activity by date range | GSI1 | Query multiple date partitions |

---

## Sessions Table

**Table Name:** `unisync-sessions`

### Key Structure

| Key | Pattern | Description |
|-----|---------|-------------|
| PK | `ACTIVE_SESSION` | Fixed partition for all active sessions |
| SK | `USER#{userId}` | User identifier |

### TTL Configuration

- **TTL Attribute:** `expiresAt`
- **TTL Duration:** 5 minutes from last heartbeat
- Sessions automatically deleted by DynamoDB when expired

### Attributes

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | String | Yes | User identifier |
| `userName` | String | Yes | User's display name |
| `showSetId` | String | No | ShowSet currently being viewed |
| `activity` | String | Yes | Current activity description |
| `startedAt` | String (ISO8601) | Yes | Session start time |
| `lastHeartbeat` | String (ISO8601) | Yes | Last heartbeat time |
| `expiresAt` | Number | Yes | Unix timestamp for TTL |

### Example Item

```json
{
  "PK": "ACTIVE_SESSION",
  "SK": "USER#usr_abc123",
  "userId": "usr_abc123",
  "userName": "John Smith",
  "showSetId": "SS-311-001",
  "activity": "Editing screen stage",
  "startedAt": "2024-01-15T10:00:00.000Z",
  "lastHeartbeat": "2024-01-15T10:29:00.000Z",
  "expiresAt": 1705314840
}
```

### Access Patterns

| Pattern | Keys Used | Query |
|---------|-----------|-------|
| Get all active sessions | PK | `PK = ACTIVE_SESSION` |
| Get user's session | PK, SK | `PK = ACTIVE_SESSION AND SK = USER#<userId>` |
| Update heartbeat | PK, SK | Update item |

---

## Data Model Diagram

```mermaid
erDiagram
    USERS {
        string PK "USER#{userId}"
        string SK "PROFILE"
        string GSI1PK "EMAIL#{email}"
        string GSI1SK "PROFILE"
        string userId
        string email
        string name
        string role
        string status
        string preferredLang
        string cognitoSub
        boolean canEditVersions
    }

    SHOWSETS {
        string PK "SHOWSET#{showSetId}"
        string SK "DETAILS"
        string GSI1PK "AREA#{area}"
        string GSI1SK "SHOWSET#{showSetId}"
        string showSetId
        string area
        string scene
        object description
        array vmList
        object stages
        object links
        number screenVersion
        number revitVersion
        number drawingVersion
        array versionHistory
    }

    NOTES {
        string PK "SHOWSET#{showSetId}"
        string SK "NOTE#{timestamp}#{noteId}"
        string noteId
        string showSetId
        string authorId
        string authorName
        string originalLang
        object content
        string translationStatus
        array attachments
    }

    ACTIVITY {
        string PK "SHOWSET#{showSetId}"
        string SK "ACTIVITY#{timestamp}#{activityId}"
        string GSI1PK "ACTIVITY_DATE#{date}"
        string GSI1SK "{timestamp}#{activityId}"
        string activityId
        string showSetId
        string userId
        string userName
        string action
        object details
    }

    SESSIONS {
        string PK "ACTIVE_SESSION"
        string SK "USER#{userId}"
        string userId
        string userName
        string showSetId
        string activity
        number expiresAt
    }

    USERS ||--o{ NOTES : creates
    USERS ||--o{ ACTIVITY : generates
    USERS ||--o| SESSIONS : has
    SHOWSETS ||--o{ NOTES : has
    SHOWSETS ||--o{ ACTIVITY : has
```

---

## Enumerations

### UserRole
```
admin | bim_coordinator | 3d_modeller | 2d_drafter
```

### UserStatus
```
active | deactivated
```

### Language
```
en | zh | zh-TW
```

### Area
```
311 | 312
```

### StageName
```
screen | structure | integrated | inBim360 | drawing2d
```

### StageStatus
```
not_started | in_progress | complete | on_hold | client_review | engineer_review | revision_required
```

### TranslationStatus
```
pending | complete | failed
```

### ActivityAction
```
status_change | assignment | link_update | version_update | note_added | showset_created
```

### VersionType
```
screenVersion | revitVersion | drawingVersion
```

---

## S3 Storage

### Attachments Bucket

**Bucket Name:** `unisync-attachments-{account}-{region}`

**Key Structure:**
```
notes/{noteId}/{attachmentId}/{fileName}
```

**Example:**
```
notes/note_xyz789/att_001/screenshot.png
```

Files are accessed via presigned URLs generated by the Notes Lambda handler.
