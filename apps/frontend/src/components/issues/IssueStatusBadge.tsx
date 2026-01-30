import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { IssueStatus } from '@unisync/shared-types';
import { cn } from '@/lib/utils';

interface IssueStatusBadgeProps {
  status: IssueStatus;
  className?: string;
  canClose?: boolean;
  isLoading?: boolean;
  onClick?: () => void;
}

export function IssueStatusBadge({
  status,
  className,
  canClose = false,
  isLoading = false,
  onClick
}: IssueStatusBadgeProps) {
  const { t } = useTranslation();

  const isClickable = canClose && onClick && !isLoading;

  return (
    <Badge
      variant={status === 'open' ? 'in_progress' : 'default'}
      className={cn(
        className,
        isClickable && 'cursor-pointer hover:opacity-80 transition-opacity',
        isLoading && 'opacity-50'
      )}
      onClick={isClickable ? onClick : undefined}
      title={canClose ? (status === 'open' ? t('issues.close') : t('issues.reopen')) : undefined}
    >
      {t(`issues.${status}`)}
    </Badge>
  );
}
