import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface CloseIssueDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (comment: string) => void;
  isLoading?: boolean;
}

export function CloseIssueDialog({ open, onClose, onConfirm, isLoading }: CloseIssueDialogProps) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');

  const handleClose = () => {
    setComment('');
    onClose();
  };

  const handleConfirm = () => {
    if (comment.trim()) {
      onConfirm(comment.trim());
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('issues.closePromptTitle')}</DialogTitle>
          <DialogDescription>
            {t('issues.closePromptDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <textarea
            className="w-full min-h-[80px] p-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('issues.closingCommentPlaceholder')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isLoading}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            {t('issues.keepOpen')}
          </Button>
          <Button onClick={handleConfirm} disabled={!comment.trim() || isLoading}>
            {isLoading ? t('common.loading') : t('issues.closeIssue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
