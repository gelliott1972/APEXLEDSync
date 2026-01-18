import { fetchAuthSession } from 'aws-amplify/auth';
import type {
  ShowSet,
  ShowSetCreateInput,
  ShowSetUpdateInput,
  StageUpdateInput,
  LinksUpdateInput,
  Note,
  NoteCreateInput,
  NoteAttachment,
  Session,
  SessionStartInput,
  User,
  UserUpdateInput,
  Activity,
  StageName,
} from '@unisync/shared-types';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

async function getAuthToken(): Promise<string> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken();

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message ?? 'Request failed');
  }

  return data.data;
}

// ShowSets API
export const showSetsApi = {
  list: (area?: string) =>
    request<ShowSet[]>(`/showsets${area ? `?area=${area}` : ''}`),

  get: (id: string) => request<ShowSet>(`/showsets/${id}`),

  create: (input: ShowSetCreateInput) =>
    request<ShowSet>('/showsets', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (id: string, input: ShowSetUpdateInput) =>
    request<void>(`/showsets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  delete: (id: string) =>
    request<void>(`/showsets/${id}`, { method: 'DELETE' }),

  updateStage: (id: string, stage: StageName, input: StageUpdateInput) =>
    request<void>(`/showsets/${id}/stage/${stage}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  updateLinks: (id: string, input: LinksUpdateInput) =>
    request<void>(`/showsets/${id}/links`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
};

// Notes API
export const notesApi = {
  list: (showSetId: string) =>
    request<Note[]>(`/showsets/${showSetId}/notes`),

  create: (showSetId: string, input: NoteCreateInput) =>
    request<Note>(`/showsets/${showSetId}/notes`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (noteId: string, showSetId: string, content: string) =>
    request<void>(`/notes/${noteId}?showSetId=${showSetId}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  delete: (noteId: string, showSetId: string) =>
    request<void>(`/notes/${noteId}?showSetId=${showSetId}`, {
      method: 'DELETE',
    }),

  // Attachment methods
  presignUpload: (noteId: string, showSetId: string, file: { fileName: string; mimeType: string; fileSize: number }) =>
    request<{ uploadUrl: string; attachmentId: string; s3Key: string }>(
      `/notes/${noteId}/attachments/presign?showSetId=${showSetId}`,
      {
        method: 'POST',
        body: JSON.stringify(file),
      }
    ),

  confirmUpload: (
    noteId: string,
    attachmentId: string,
    showSetId: string,
    details: { fileName: string; mimeType: string; fileSize: number; s3Key: string }
  ) =>
    request<NoteAttachment>(
      `/notes/${noteId}/attachments/${attachmentId}/confirm?showSetId=${showSetId}`,
      {
        method: 'POST',
        body: JSON.stringify(details),
      }
    ),

  getAttachment: (noteId: string, attachmentId: string, showSetId: string) =>
    request<{ downloadUrl: string; attachment: NoteAttachment }>(
      `/notes/${noteId}/attachments/${attachmentId}?showSetId=${showSetId}`
    ),

  deleteAttachment: (noteId: string, attachmentId: string, showSetId: string) =>
    request<void>(
      `/notes/${noteId}/attachments/${attachmentId}?showSetId=${showSetId}`,
      { method: 'DELETE' }
    ),

  // Upload file helper - combines presign + upload + confirm
  uploadFile: async (
    noteId: string,
    showSetId: string,
    file: File
  ): Promise<NoteAttachment> => {
    // 1. Get presigned URL
    const { uploadUrl, attachmentId, s3Key } = await notesApi.presignUpload(
      noteId,
      showSetId,
      {
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      }
    );

    // 2. Upload file directly to S3
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type,
      },
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload file to S3');
    }

    // 3. Confirm upload
    const attachment = await notesApi.confirmUpload(noteId, attachmentId, showSetId, {
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      s3Key,
    });

    return attachment;
  },
};

// Sessions API
export const sessionsApi = {
  list: () => request<Session[]>('/sessions'),

  start: (input: SessionStartInput) =>
    request<Session>('/sessions/start', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  heartbeat: (showSetId?: string, activity?: string) =>
    request<void>('/sessions/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ showSetId, activity }),
    }),

  end: () =>
    request<void>('/sessions/end', { method: 'POST' }),
};

// Activity API
export const activityApi = {
  forShowSet: (showSetId: string, limit = 50) =>
    request<Activity[]>(`/showsets/${showSetId}/activity?limit=${limit}`),

  recent: (limit = 50, days = 7) =>
    request<Activity[]>(`/activity/recent?limit=${limit}&days=${days}`),
};

// Users API (Admin only)
export const usersApi = {
  list: () => request<User[]>('/users'),

  get: (userId: string) => request<User>(`/users/${userId}`),

  update: (userId: string, input: UserUpdateInput) =>
    request<void>(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  delete: (userId: string) =>
    request<void>(`/users/${userId}`, { method: 'DELETE' }),
};

// Profile API
export const profileApi = {
  update: (name?: string, preferredLang?: string) =>
    request<void>('/auth/update-profile', {
      method: 'POST',
      body: JSON.stringify({ name, preferredLang }),
    }),
};

// Translate API
export interface TranslateResponse {
  translations: {
    en: string;
    zh: string;
    'zh-TW': string;
  };
}

export const translateApi = {
  translate: (text: string, sourceLanguage: 'en' | 'zh' | 'zh-TW') =>
    request<TranslateResponse>('/translate', {
      method: 'POST',
      body: JSON.stringify({ text, sourceLanguage }),
    }),
};
