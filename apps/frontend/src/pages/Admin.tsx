import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, FileEdit, Loader2, Copy, Check } from 'lucide-react';
import { usersApi } from '@/lib/api';
import type { User, UserRole, Language } from '@unisync/shared-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function AdminPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<{ email: string; name: string; tempPassword: string } | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  const createUserMutation = useMutation({
    mutationFn: usersApi.create,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreateDialog(false);
      // If we got a temp password back, show the invite dialog
      if (data.tempPassword) {
        setInviteData({
          email: data.email,
          name: data.name,
          tempPassword: data.tempPassword,
        });
      }
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => usersApi.delete(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setUserToDelete(null);
      setDeleteError(null);
    },
    onError: (error: Error) => {
      setDeleteError(error.message || 'Failed to deactivate user');
    },
  });

  const toggleVersionEditMutation = useMutation({
    mutationFn: ({ userId, canEditVersions }: { userId: string; canEditVersions: boolean }) =>
      usersApi.update(userId, { canEditVersions }),
    onMutate: async ({ userId, canEditVersions }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['users'] });

      // Snapshot current state
      const previousUsers = queryClient.getQueryData<User[]>(['users']);

      // Optimistically update the cache
      queryClient.setQueryData(['users'], (old: User[] | undefined) =>
        old?.map((u) => u.userId === userId ? { ...u, canEditVersions } : u)
      );

      return { previousUsers };
    },
    onError: (_err, _variables, context) => {
      // Revert on error
      if (context?.previousUsers) {
        queryClient.setQueryData(['users'], context.previousUsers);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: { name?: string; role?: UserRole; preferredLang?: Language } }) =>
      usersApi.update(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
    },
  });

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin':
        return 'destructive';
      case 'bim_coordinator':
        return 'default';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('admin.createUser')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.users')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">{t('auth.email')}</th>
                    <th className="px-4 py-3 text-left">{t('admin.role')}</th>
                    <th className="px-4 py-3 text-left">{t('admin.status')}</th>
                    <th className="px-4 py-3 text-center" title={t('admin.canEditVersionsTooltip')}>
                      <div className="flex items-center justify-center gap-1">
                        <FileEdit className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('admin.canEditVersions')}</span>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((user) => (
                    <tr key={user.userId} className="hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium">{user.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {user.email}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={getRoleBadgeVariant(user.role) as any}>
                          {t(`roles.${user.role}`)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={user.status === 'active' ? 'complete' : 'not_started'}
                        >
                          {t(`admin.${user.status}`)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Switch
                          checked={user.canEditVersions ?? false}
                          onCheckedChange={(checked) =>
                            toggleVersionEditMutation.mutate({
                              userId: user.userId,
                              canEditVersions: checked,
                            })
                          }
                          disabled={user.status === 'deactivated'}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingUser(user)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setUserToDelete(user)}
                            disabled={user.status === 'deactivated'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      {editingUser && (
        <EditUserDialog
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={(data) => updateUserMutation.mutate({ userId: editingUser.userId, data })}
          isPending={updateUserMutation.isPending}
          t={t}
        />
      )}

      {/* Create User Dialog */}
      {showCreateDialog && (
        <CreateUserDialog
          onClose={() => setShowCreateDialog(false)}
          onSave={(data) => createUserMutation.mutate(data)}
          isPending={createUserMutation.isPending}
          error={createUserMutation.error?.message}
          t={t}
        />
      )}

      {/* Invite Dialog - shows temp password for clipboard */}
      {inviteData && (
        <InviteDialog
          email={inviteData.email}
          name={inviteData.name}
          tempPassword={inviteData.tempPassword}
          onClose={() => setInviteData(null)}
          t={t}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.deactivateUser')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.deactivateConfirm', { name: userToDelete?.name, email: userToDelete?.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setUserToDelete(null); setDeleteError(null); }}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => userToDelete && deactivateMutation.mutate(userToDelete.userId)}
              disabled={deactivateMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deactivateMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('common.loading')}</>
              ) : (
                t('admin.deactivate')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSave,
  isPending,
  t,
}: {
  user: User;
  onClose: () => void;
  onSave: (data: { name?: string; role?: UserRole; preferredLang?: Language }) => void;
  isPending: boolean;
  t: (key: string) => string;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<UserRole>(user.role);
  const [preferredLang, setPreferredLang] = useState<Language>(user.preferredLang);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: name !== user.name ? name : undefined,
      role: role !== user.role ? role : undefined,
      preferredLang: preferredLang !== user.preferredLang ? preferredLang : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">{t('admin.editUser')}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-sm">{t('auth.email')}</Label>
            <Input id="email" value={user.email} disabled className="bg-muted" />
          </div>
          <div>
            <Label htmlFor="name" className="text-sm">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="text-sm">{t('admin.role')}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t('roles.admin')}</SelectItem>
                <SelectItem value="bim_coordinator">{t('roles.bim_coordinator')}</SelectItem>
                <SelectItem value="engineer">{t('roles.engineer')}</SelectItem>
                <SelectItem value="3d_modeller">{t('roles.3d_modeller')}</SelectItem>
                <SelectItem value="2d_drafter">{t('roles.2d_drafter')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Language</Label>
            <Select value={preferredLang} onValueChange={(v) => setPreferredLang(v as Language)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">简体中文</SelectItem>
                <SelectItem value="zh-TW">繁體中文</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('common.loading')}</>
              ) : (
                t('common.save')
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateUserDialog({
  onClose,
  onSave,
  isPending,
  error,
  t,
}: {
  onClose: () => void;
  onSave: (data: { email: string; name: string; role: UserRole; preferredLang: Language; skipEmail?: boolean }) => void;
  isPending: boolean;
  error?: string;
  t: (key: string) => string;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('3d_modeller');
  const [preferredLang, setPreferredLang] = useState<Language>('en');
  const [skipEmail, setSkipEmail] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ email, name, role, preferredLang, skipEmail });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">{t('admin.createUser')}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="create-email" className="text-sm">{t('auth.email')}</Label>
            <Input
              id="create-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="create-name" className="text-sm">Name</Label>
            <Input
              id="create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="text-sm">{t('admin.role')}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t('roles.admin')}</SelectItem>
                <SelectItem value="bim_coordinator">{t('roles.bim_coordinator')}</SelectItem>
                <SelectItem value="engineer">{t('roles.engineer')}</SelectItem>
                <SelectItem value="3d_modeller">{t('roles.3d_modeller')}</SelectItem>
                <SelectItem value="2d_drafter">{t('roles.2d_drafter')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Language</Label>
            <Select value={preferredLang} onValueChange={(v) => setPreferredLang(v as Language)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">简体中文</SelectItem>
                <SelectItem value="zh-TW">繁體中文</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="skipEmail"
              checked={skipEmail}
              onCheckedChange={(checked) => setSkipEmail(checked === true)}
            />
            <Label htmlFor="skipEmail" className="text-sm cursor-pointer">
              {t('admin.skipEmailInvite')}
            </Label>
          </div>

          <p className="text-xs text-muted-foreground">
            {skipEmail ? t('admin.clipboardInviteNote') : t('admin.tempPasswordNote')}
          </p>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('common.loading')}</>
              ) : (
                t('common.create')
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InviteDialog({
  email,
  name,
  tempPassword,
  onClose,
  t,
}: {
  email: string;
  name: string;
  tempPassword: string;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const [copied, setCopied] = useState(false);
  const appUrl = window.location.origin;

  const inviteMessage = `Hi ${name},

You've been invited to UniSync BIM Coordination Board.

Login URL: ${appUrl}
Email: ${email}
Temporary Password: ${tempPassword}

You'll be asked to set a new password on your first login.`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">{t('admin.userCreated')}</h2>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('admin.copyInviteMessage')}
          </p>

          <div className="bg-muted rounded-md p-3 text-sm font-mono whitespace-pre-wrap break-all">
            {inviteMessage}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button onClick={handleCopy}>
              {copied ? (
                <><Check className="h-4 w-4 mr-2" />{t('common.copied')}</>
              ) : (
                <><Copy className="h-4 w-4 mr-2" />{t('common.copyToClipboard')}</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
