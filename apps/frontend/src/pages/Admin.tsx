import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, FileEdit } from 'lucide-react';
import { usersApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

export function AdminPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => usersApi.delete(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const toggleVersionEditMutation = useMutation({
    mutationFn: ({ userId, canEditVersions }: { userId: string; canEditVersions: boolean }) =>
      usersApi.update(userId, { canEditVersions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
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
        <Button>
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
                          disabled={
                            toggleVersionEditMutation.isPending ||
                            user.status === 'deactivated' ||
                            user.role === 'admin' // Admins always have permission
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deactivateMutation.mutate(user.userId)}
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
    </div>
  );
}
