export type UserRole = 'admin' | 'bim_coordinator' | '3d_modeller' | '2d_drafter';

export type UserStatus = 'active' | 'deactivated';

export type Language = 'en' | 'zh' | 'zh-TW';

export interface User {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  preferredLang: Language;
  cognitoSub: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserCreateInput {
  email: string;
  name: string;
  role: UserRole;
  preferredLang?: Language;
}

export interface UserUpdateInput {
  name?: string;
  role?: UserRole;
  preferredLang?: Language;
  status?: UserStatus;
}

export interface ProfileUpdateInput {
  name?: string;
  preferredLang?: Language;
}

// DynamoDB key structure
export interface UserDDBKeys {
  PK: `USER#${string}`;
  SK: 'PROFILE';
}

export interface UserEmailGSI {
  GSI1PK: `EMAIL#${string}`;
  GSI1SK: 'PROFILE';
}
