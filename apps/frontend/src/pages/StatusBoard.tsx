import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Play, Square, Clock } from 'lucide-react';
import { sessionsApi, activityApi } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { Session, Activity } from '@unisync/shared-types';

function SessionCard({ session }: { session: Session }) {
  const { t } = useTranslation();

  const initials = session.userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const startTime = new Date(session.startedAt);
  const duration = Math.floor((Date.now() - startTime.getTime()) / 1000 / 60);

  return (
    <div className="flex items-center gap-4 p-4 border rounded-lg">
      <Avatar>
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{session.userName}</p>
        <p className="text-sm text-muted-foreground truncate">
          {session.showSetId
            ? `${t('sessions.workingOn')} ${session.showSetId}`
            : session.activity}
        </p>
      </div>
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        <span>{duration}m</span>
      </div>
    </div>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const { t } = useTranslation();

  const time = new Date(activity.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const getActionText = () => {
    switch (activity.action) {
      case 'status_change':
        const details = activity.details as { stage: string; from: string; to: string };
        return `${t(`stages.${details.stage}`)}: ${t(`status.${details.from}`)} → ${t(`status.${details.to}`)}`;
      case 'note_added':
        return t('notes.addNote');
      case 'showset_created':
        return t('showset.createNew');
      default:
        return activity.action;
    }
  };

  return (
    <div className="flex items-start gap-3 py-2">
      <span className="text-xs text-muted-foreground w-12 shrink-0">{time}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">{activity.userName}</span>
          {' - '}
          <span className="text-muted-foreground">{activity.showSetId}</span>
        </p>
        <p className="text-sm text-muted-foreground">{getActionText()}</p>
      </div>
    </div>
  );
}

export function StatusBoardPage() {
  const { t } = useTranslation();
  const { isWorking, startSession, endSession } = useSessionStore();

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
    refetchInterval: 30000, // 30 seconds
  });

  const { data: recentActivity = [] } = useQuery({
    queryKey: ['activity', 'recent'],
    queryFn: () => activityApi.recent(20, 1),
    refetchInterval: 60000, // 1 minute
  });

  const handleToggleSession = async () => {
    if (isWorking) {
      await endSession();
    } else {
      await startSession(undefined, [], 'Working');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('sessions.title')}</h1>
        <Button
          variant={isWorking ? 'destructive' : 'default'}
          onClick={handleToggleSession}
        >
          {isWorking ? (
            <>
              <Square className="mr-2 h-4 w-4" />
              {t('sessions.endSession')}
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              {t('sessions.startSession')}
            </>
          )}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Active Sessions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {t('sessions.title')}
              <Badge variant="secondary">{sessions.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {t('sessions.noActiveSessions')}
              </p>
            ) : (
              sessions.map((session) => (
                <SessionCard key={session.userId} session={session} />
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {recentActivity.map((activity) => (
                <ActivityItem key={activity.activityId} activity={activity} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
