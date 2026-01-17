# Coordination Board — Technical Specification

## Overview

A web application for tracking BIM model progress and team coordination across sites in China and Hong Kong. Supports multi-language UI and auto-translated user content.

### Project Context

Two sites: 311 Attraction Tower and 312 Marvel Plaza. Multiple LED screen models (ShowSets) need to progress through a pipeline from 3D modelling to approved 2D drawings. Team is distributed across China and Hong Kong, working at different times.

---

## Tech Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| Frontend | React + Vite | SPA |
| Hosting | S3 + CloudFront | ap-east-1 (Hong Kong) |
| API | API Gateway + Lambda | REST, ap-east-1 |
| Database | DynamoDB | ap-east-1 |
| Auth | Cognito | Email/password |
| Translation | AWS Translate | Cached in DB |
| Region | ap-east-1 | Hong Kong — accessible from mainland China |

---

## User Roles & Permissions

| Role | Permissions |
|------|-------------|
| Admin | Full access, manage users, manage ShowSets |
| BIM Coordinator | Update all stages, manage links, view all |
| 3D Modeller | Update Screen/Structure/Integrated stages, add handover notes |
| 2D Drafter | Update 2D stages, add handover notes |
| Viewer | Read-only (for customer access — optional, can add later) |

---

## Data Model

### Users Table

```
PK: USER#<userId>
SK: PROFILE

{
  userId: string,
  email: string,
  name: string,
  role: "admin" | "bim_coordinator" | "3d_modeller" | "2d_drafter" | "viewer",
  preferredLang: "en" | "zh" | "zh-TW",
  createdAt: string (ISO),
  updatedAt: string (ISO)
}
```

### ShowSets Table

```
PK: SHOWSET#<showSetId>
SK: DETAILS

{
  showSetId: string,          // e.g., "SS-07-01"
  area: "311" | "312",
  scene: string,              // e.g., "SC07"
  description: {
    en: string,
    zh: string,
    zh-TW: string
  },
  vmList: string[],           // e.g., ["VM-0701", "VM-0702", "VM-0703", "VM-0704"]
  
  // Pipeline status
  stages: {
    screen: {
      status: "not_started" | "in_progress" | "complete" | "blocked",
      assignedTo: string | null,
      updatedBy: string,
      updatedAt: string,
      version: string | null   // e.g., "v1"
    },
    structure: { ... same shape ... },
    integrated: { ... same shape ... },
    inBim360: { ... same shape ... },
    awaitingClient: {
      status: "not_started" | "in_progress" | "complete" | "blocked",
      updatedBy: string,
      updatedAt: string
    },
    drawing2d: {
      status: "not_started" | "in_progress" | "awaiting_engineering" | "draft_released" | "approved" | "blocked",
      assignedTo: string | null,
      updatedBy: string,
      updatedAt: string,
      version: string | null   // e.g., "v1" (separate from model version)
    }
  },
  
  // Links
  links: {
    modelUrl: string | null,      // BIM360 link to model
    drawingsUrl: string | null    // BIM360 link to drawings folder
  },
  
  createdAt: string,
  updatedAt: string
}
```

### Notes Table

```
PK: SHOWSET#<showSetId>
SK: NOTE#<timestamp>#<noteId>

{
  noteId: string,
  showSetId: string,
  authorId: string,
  authorName: string,
  originalLang: "en" | "zh" | "zh-TW",
  content: {
    en: string,
    zh: string,
    zh-TW: string
  },
  translationStatus: "pending" | "complete",
  createdAt: string,
  updatedAt: string
}
```

### Activity Log Table

```
PK: SHOWSET#<showSetId>
SK: ACTIVITY#<timestamp>#<activityId>

{
  activityId: string,
  showSetId: string,
  userId: string,
  userName: string,
  action: "status_change" | "assignment" | "link_update" | "version_update",
  details: {
    stage: string,
    from: string,
    to: string,
    version: string | null
  },
  createdAt: string
}
```

### Active Sessions Table (for "Who's Working on What")

```
PK: ACTIVE_SESSION
SK: USER#<userId>

{
  userId: string,
  userName: string,
  showSetId: string | null,
  activity: string,           // e.g., "Modelling", "Drafting"
  startedAt: string,
  lastHeartbeat: string       // Updated every 60s, used to detect inactive sessions
}
```

---

## Pipeline Stages & Colours

### 3D Modelling Track

| Stage | Owner | Statuses |
|-------|-------|----------|
| Screen | 3D Modeller | Not Started (grey), In Progress (yellow), Complete (green), Blocked (red) |
| Structure | 3D Modeller | Same as above |
| Integrated | 3D Modeller | Same as above |
| In BIM360 | BIM Coordinator | Same as above |

### Client Review Track (parallel)

| Stage | Owner | Statuses |
|-------|-------|----------|
| Awaiting Client | BIM Coordinator | Not Started (grey), In Progress (blue), Complete (green), Blocked (red) |

### 2D Drawings Track (can start in parallel)

| Stage | Owner | Statuses |
|-------|-------|----------|
| 2D Drawings | 2D Drafter | Not Started (grey), In Progress (yellow), Awaiting Engineering (purple), DRAFT Released (yellow), Approved (green), Blocked (red) |

### Colour Mapping

```javascript
const STATUS_COLOURS = {
  not_started: '#9E9E9E',      // Grey
  in_progress: '#FFC107',      // Yellow/Amber
  complete: '#4CAF50',         // Green
  blocked: '#F44336',          // Red
  awaiting_client: '#2196F3',  // Blue
  awaiting_engineering: '#9C27B0', // Purple
  draft_released: '#FF9800'    // Orange
};
```

---

## API Endpoints

### Auth (Cognito handles most of this)

```
POST /auth/register        — Admin only, create new user
POST /auth/update-profile  — Update own profile (name, preferred language)
```

### ShowSets

```
GET    /showsets                    — List all ShowSets (with current status)
GET    /showsets/:id                — Get ShowSet details
POST   /showsets                    — Create ShowSet (Admin/BIM Coordinator)
PUT    /showsets/:id                — Update ShowSet details
DELETE /showsets/:id                — Delete ShowSet (Admin only)

PUT    /showsets/:id/stage/:stage   — Update stage status
       Body: { status, version?, assignedTo? }
       
PUT    /showsets/:id/links          — Update BIM360 links
       Body: { modelUrl?, drawingsUrl? }
```

### Notes

```
GET    /showsets/:id/notes          — Get notes for ShowSet
POST   /showsets/:id/notes          — Add note
       Body: { content, lang }
       Response includes noteId, triggers async translation
       
PUT    /notes/:noteId               — Edit note (author only)
DELETE /notes/:noteId               — Delete note (author or admin)
```

### Activity

```
GET    /showsets/:id/activity       — Get activity log for ShowSet
GET    /activity/recent             — Get recent activity across all ShowSets
```

### Sessions (Who's Working on What)

```
GET    /sessions                    — Get all active sessions
POST   /sessions/start              — Start working on a ShowSet
       Body: { showSetId, activity }
POST   /sessions/heartbeat          — Keep session alive (called every 60s)
POST   /sessions/end                — End session
```

### Users (Admin only)

```
GET    /users                       — List all users
PUT    /users/:id                   — Update user (role, etc.)
DELETE /users/:id                   — Deactivate user
```

---

## Translation Lambda

### Trigger

When a note is created or edited, the API Lambda writes the note with `translationStatus: "pending"` and sends a message to an SQS queue (or invokes async).

### Translation Lambda Flow

```
1. Receive note (noteId, showSetId, content, originalLang)
2. Determine target languages (the other 2)
3. Call AWS Translate for each target language
4. Update note in DynamoDB with translated content
5. Set translationStatus: "complete"
```

### Error Handling

If translation fails:
- Retry 3 times
- If still failing, set translationStatus: "failed"
- UI shows original text with indicator that translation unavailable

---

## Frontend Pages

### 1. Login Page

- Email + password
- "Forgot password" link (Cognito handles)
- Language selector (affects UI before login)

### 2. Dashboard / Progress Board

Main view — shows all ShowSets in a Kanban-style board or table view.

**Kanban View:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Screen    │  Structure  │ Integrated │ In BIM360 │ Awaiting  │    2D      │
│            │             │            │           │  Client   │            │
├─────────────────────────────────────────────────────────────────────────────┤
│ [SS-07-01] │             │            │           │           │            │
│ [SS-07-02] │ [SS-08-01]  │            │ [SS-07-04]│[SS-09-01] │ [SS-10-01] │
│            │             │ [SS-08-02] │           │           │            │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Table View (alternative):**
| ShowSet | Area | Scene | Screen | Structure | Integrated | In BIM360 | Client | 2D | Model Ver | 2D Ver |
|---------|------|-------|--------|-----------|------------|-----------|--------|-----|-----------|--------|
| SS-07-01 | 311 | SC07 | 🟢 | 🟢 | 🟡 | ⬜ | ⬜ | ⬜ | v2 | — |

**Features:**
- Filter by Area (311/312), Scene, Status
- Search by ShowSet ID or description
- Click ShowSet to open detail panel
- Toggle between Kanban and Table view
- Auto-refresh every 60 seconds

### 3. ShowSet Detail Panel (Slide-out or Modal)

```
┌─────────────────────────────────────────────────────────────┐
│ SS-07-01 — RAD Door                              [✕ Close] │
├─────────────────────────────────────────────────────────────┤
│ Area: 311    Scene: SC07                                    │
│                                                             │
│ VMs: VM-0701, VM-0702, VM-0703, VM-0704      [View All →]  │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Pipeline Status                                         │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Screen      [🟢 Complete ▾]  v2   Assigned: Mr. Du      │ │
│ │ Structure   [🟢 Complete ▾]  v2   Assigned: Mr. Du      │ │
│ │ Integrated  [🟡 In Progress▾] v2   Assigned: Mr. Du     │ │
│ │ In BIM360   [⬜ Not Started▾] —    —                     │ │
│ │ Client      [⬜ Not Started▾]                            │ │
│ │ 2D          [⬜ Not Started▾] —    Assigned: —           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Links                                          [Edit Links] │
│ • Model: https://bim360.autodesk.com/...                   │
│ • Drawings: https://bim360.autodesk.com/...                │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Handover Notes                                          │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Mr. Du (15 Jan, 5:30pm)                                 │ │
│ │ North side brackets complete. South side needs work.    │ │
│ │                                                         │ │
│ │ Ms. Chen (16 Jan, 9:00am)                               │ │
│ │ Starting north elevation drawings.                      │ │
│ │                                                         │ │
│ │ [Add Note...]                                           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Activity Log                                   [View All →] │
│ • 16 Jan 9:00am — Ms. Chen started 2D                      │
│ • 15 Jan 5:30pm — Mr. Du set Integrated to In Progress     │
└─────────────────────────────────────────────────────────────┘
```

### 4. Status Board (Who's Working on What)

```
┌─────────────────────────────────────────────────────────────┐
│ Currently Active                                            │
├─────────────────────────────────────────────────────────────┤
│ Mr. Du        │ SS-07-01  │ Modelling  │ Started 9:00am    │
│ Ms. Chen      │ SS-08-02  │ Drafting   │ Started 2:00pm    │
│ Mr. Wong      │ —         │ Available  │ —                 │
└─────────────────────────────────────────────────────────────┘
```

Users click "Start Working" button when they begin, and "Finish" when done.

Sessions auto-expire if no heartbeat for 5 minutes.

### 5. VM List Modal

When clicking "View All" VMs:

```
┌─────────────────────────────────────────────┐
│ VMs in SS-07-01                   [✕ Close] │
├─────────────────────────────────────────────┤
│ • VM-0701 — Tube A                          │
│ • VM-0702 — Tube B                          │
│ • VM-0703 — Tube C                          │
│ • VM-0704 — Tube A                          │
└─────────────────────────────────────────────┘
```

### 6. Links Modal

When clicking "Edit Links":

```
┌─────────────────────────────────────────────┐
│ BIM360 Links — SS-07-01           [✕ Close] │
├─────────────────────────────────────────────┤
│ Model URL:                                  │
│ [https://bim360.autodesk.com/...         ] │
│                                             │
│ Drawings URL:                               │
│ [https://bim360.autodesk.com/...         ] │
│                                             │
│                        [Cancel]  [Save]     │
└─────────────────────────────────────────────┘
```

### 7. Admin Panel

- User management (invite, edit role, deactivate)
- ShowSet management (create, edit, delete)
- System settings

---

## Internationalisation (i18n)

### UI Strings

Store in JSON files:

```
/locales
  /en.json
  /zh.json      (Simplified Chinese)
  /zh-TW.json   (Traditional Chinese)
```

Example:
```json
// en.json
{
  "nav.dashboard": "Dashboard",
  "nav.status": "Status Board",
  "status.not_started": "Not Started",
  "status.in_progress": "In Progress",
  "status.complete": "Complete",
  "status.blocked": "Blocked",
  "status.awaiting_client": "Awaiting Client",
  "status.awaiting_engineering": "Awaiting Engineering",
  "status.draft_released": "DRAFT Released",
  "status.approved": "Approved",
  ...
}
```

### User-Generated Content

- Stored with translations in all 3 languages
- Displayed in user's preferred language
- Shows "Translated" indicator with option to view original

---

## Deployment

### Infrastructure (Terraform or CDK)

```
/infrastructure
  /lib
    api-stack.ts        — API Gateway, Lambdas
    database-stack.ts   — DynamoDB tables
    auth-stack.ts       — Cognito
    frontend-stack.ts   — S3, CloudFront
    translation-stack.ts — Translation Lambda, SQS
```

### CI/CD

- GitHub Actions or CodePipeline
- On push to main: build frontend, deploy to S3, invalidate CloudFront
- Separate workflow for Lambda deployment

---

## Future Enhancements (Not in v1)

1. **WeChat Notifications** — Lambda triggered by status changes, calls WeChat API
2. **Real-time Updates** — AppSync subscriptions instead of polling
3. **Customer View** — Read-only role with limited visibility
4. **Reports** — Progress reports, velocity tracking
5. **File Attachments** — Upload images/PDFs to notes
6. **Mobile App** — React Native or WeChat Mini Program

---

## Development Phases

### Phase 1 — Core Infrastructure
- [ ] Set up AWS infrastructure (DynamoDB, Cognito, API Gateway, Lambda)
- [ ] Basic auth flow (register, login, logout)
- [ ] User profile with language preference

### Phase 2 — ShowSet Management
- [ ] CRUD for ShowSets
- [ ] Pipeline status updates
- [ ] Links management
- [ ] VM list display

### Phase 3 — Notes & Translation
- [ ] Create/read notes
- [ ] Translation Lambda
- [ ] Display translated content

### Phase 4 — Status Board
- [ ] Active sessions tracking
- [ ] Start/end session flow
- [ ] Heartbeat mechanism

### Phase 5 — Frontend Polish
- [ ] Kanban and Table views
- [ ] Filtering and search
- [ ] Auto-refresh (60s polling)
- [ ] Full i18n

### Phase 6 — Admin & Deployment
- [ ] Admin panel
- [ ] Production deployment
- [ ] CloudFront distribution

---

## File Structure

```
/coordination-board
  /infrastructure         — AWS CDK or Terraform
  /backend
    /src
      /handlers           — Lambda handlers
        auth.ts
        showsets.ts
        notes.ts
        sessions.ts
        translate.ts
      /lib
        dynamodb.ts
        translate.ts
        auth.ts
      /types
        index.ts
    package.json
    tsconfig.json
    
  /frontend
    /src
      /components
        /common           — Button, Modal, Card, etc.
        /layout           — Header, Sidebar, etc.
        /showset          — ShowSetCard, ShowSetDetail, etc.
        /notes            — NoteList, NoteForm, etc.
        /status           — StatusBoard, SessionCard, etc.
      /pages
        Dashboard.tsx
        StatusBoard.tsx
        Admin.tsx
        Login.tsx
      /hooks
        useShowSets.ts
        useNotes.ts
        useSessions.ts
        useAuth.ts
      /lib
        api.ts
        i18n.ts
      /locales
        en.json
        zh.json
        zh-TW.json
      /types
        index.ts
      App.tsx
      main.tsx
    package.json
    vite.config.ts
    tailwind.config.js
```

---

## Summary

This app provides:

1. **Progress tracking** — Visual pipeline showing each ShowSet's status from 3D modelling to approved drawings
2. **Team coordination** — See who's working on what, leave handover notes
3. **Multi-language** — Full UI translation + auto-translated user content
4. **BIM360 integration** — Quick links to models and drawings
5. **Version tracking** — Track model and 2D versions separately

Built on AWS in Hong Kong region for reliable access from China and Hong Kong.
