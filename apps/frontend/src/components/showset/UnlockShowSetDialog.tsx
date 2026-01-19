import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShowSet } from '@unisync/shared-types';
import { showSetsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';

interface UnlockShowSetDialogProps {
  showSet: ShowSet;
  open: boolean;
  onClose: () => void;
}

export function UnlockShowSetDialog({ showSet, open, onClose }: UnlockShowSetDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const unlockMutation = useMutation({
    mutationFn: (unlockReason: string) =>
      showSetsApi.unlock(showSet.showSetId, unlockReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      onClose();
    },
  });

  const handleUnlock = async () => {
    if (!reason.trim()) return;

    setIsSubmitting(true);
    try {
      await unlockMutation.mutateAsync(reason.trim());
    } catch (error) {
      console.error('Failed to unlock ShowSet:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setReason('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('showset.unlock')}</DialogTitle>
          <DialogDescription>
            {showSet.showSetId}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium">{t('showset.unlockWarning')}</p>
              <p className="mt-1 text-amber-700 dark:text-amber-300">{t('showset.cascadeWarning')}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">{t('showset.unlockReason')}</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('showset.unlockReasonPlaceholder')}
              className="min-h-[100px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleUnlock}
            disabled={!reason.trim() || isSubmitting}
            variant="default"
          >
            {isSubmitting ? t('common.loading') : t('showset.unlock')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
