import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { Issue } from '@unisync/shared-types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';

interface QuickClosePopoverProps {
  issue: Issue;
  onClose: (comment: string) => Promise<void>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickClosePopover({
  onClose,
  isOpen,
  onOpenChange,
}: QuickClosePopoverProps) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!comment.trim()) return;
    setIsSubmitting(true);
    try {
      await onClose(comment);
      setComment('');
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setComment('');
    onOpenChange(false);
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 bg-background/80 hover:bg-destructive hover:text-destructive-foreground"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onOpenChange(true);
          }}
          title={t('issues.closeIssue')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-72 p-3"
        align="end"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <div className="text-sm font-medium">{t('issues.closeIssue')}</div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('issues.closingCommentPlaceholder')}
            className="min-h-[80px] text-sm resize-none"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!comment.trim() || isSubmitting}
            >
              {isSubmitting ? t('common.loading') : t('common.close')}
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
