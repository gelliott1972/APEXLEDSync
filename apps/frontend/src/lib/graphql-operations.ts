import { gql } from '@apollo/client';

// Fragment for ShowSet to reuse across queries
export const SHOWSET_FRAGMENT = gql`
  fragment ShowSetFields on ShowSet {
    showSetId
    area
    scene
    description {
      en
      zh
      zhTW
    }
    vmList {
      id
      name
    }
    stages {
      screen {
        status
        assignedTo
        updatedBy
        updatedAt
        version
        revisionNote
        revisionNoteBy
        revisionNoteAt
      }
      structure {
        status
        assignedTo
        updatedBy
        updatedAt
        version
        revisionNote
        revisionNoteBy
        revisionNoteAt
      }
      integrated {
        status
        assignedTo
        updatedBy
        updatedAt
        version
        revisionNote
        revisionNoteBy
        revisionNoteAt
      }
      inBim360 {
        status
        updatedBy
        updatedAt
        revisionNote
        revisionNoteBy
        revisionNoteAt
      }
      drawing2d {
        status
        assignedTo
        updatedBy
        updatedAt
        version
        revisionNote
        revisionNoteBy
        revisionNoteAt
      }
    }
    links {
      modelUrl
      drawingsUrl
    }
    screenVersion
    structureVersion
    integratedVersion
    bim360Version
    drawingVersion
    versionHistory {
      id
      versionType
      version
      reason {
        en
        zh
        zhTW
      }
      createdAt
      createdBy
    }
    createdAt
    updatedAt
  }
`;

export const SESSION_FRAGMENT = gql`
  fragment SessionFields on Session {
    userId
    userName
    showSetId
    workingStages
    activity
    startedAt
    lastHeartbeat
  }
`;

// Queries
export const LIST_SHOWSETS = gql`
  ${SHOWSET_FRAGMENT}
  query ListShowSets($area: String) {
    listShowSets(area: $area) {
      ...ShowSetFields
    }
  }
`;

export const GET_SHOWSET = gql`
  ${SHOWSET_FRAGMENT}
  query GetShowSet($showSetId: String!) {
    getShowSet(showSetId: $showSetId) {
      ...ShowSetFields
    }
  }
`;

export const LIST_SESSIONS = gql`
  ${SESSION_FRAGMENT}
  query ListSessions {
    listSessions {
      ...SessionFields
    }
  }
`;

// Mutations
export const UPDATE_STAGE = gql`
  ${SHOWSET_FRAGMENT}
  mutation UpdateStage($showSetId: String!, $stage: StageName!, $input: StageUpdateInput!) {
    updateStage(showSetId: $showSetId, stage: $stage, input: $input) {
      ...ShowSetFields
    }
  }
`;

export const UPDATE_LINKS = gql`
  ${SHOWSET_FRAGMENT}
  mutation UpdateLinks($showSetId: String!, $input: LinksUpdateInput!) {
    updateLinks(showSetId: $showSetId, input: $input) {
      ...ShowSetFields
    }
  }
`;

export const UPDATE_VERSION = gql`
  ${SHOWSET_FRAGMENT}
  mutation UpdateVersion($showSetId: String!, $input: VersionUpdateInput!) {
    updateVersion(showSetId: $showSetId, input: $input) {
      ...ShowSetFields
    }
  }
`;

export const START_SESSION = gql`
  ${SESSION_FRAGMENT}
  mutation StartSession($input: SessionStartInput!) {
    startSession(input: $input) {
      ...SessionFields
    }
  }
`;

export const END_SESSION = gql`
  mutation EndSession {
    endSession
  }
`;

export const HEARTBEAT = gql`
  mutation Heartbeat($showSetId: String, $activity: String, $workingStages: [StageName!]) {
    heartbeat(showSetId: $showSetId, activity: $activity, workingStages: $workingStages)
  }
`;

// Subscriptions
export const ON_SHOWSET_UPDATED = gql`
  ${SHOWSET_FRAGMENT}
  subscription OnShowSetUpdated($area: String) {
    onShowSetUpdated(area: $area) {
      ...ShowSetFields
    }
  }
`;

export const ON_SESSION_CHANGED = gql`
  ${SESSION_FRAGMENT}
  subscription OnSessionChanged {
    onSessionChanged {
      ...SessionFields
    }
  }
`;
