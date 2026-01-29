import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { IssueStatus } from '@unisync/shared-types';

interface IssueStatusBadgeProps {
  status: IssueStatus;
  className?: string;
}

export function IssueStatusBadge({ status, className }: IssueStatusBadgeProps) {
  const { t } = useTranslation();

  return (
    <Badge
      variant={status === 'open' ? 'in_progress' : 'default'}
      className={className}
    >
      {t(`issues.${status}`)}
    </Badge>
  );
}
