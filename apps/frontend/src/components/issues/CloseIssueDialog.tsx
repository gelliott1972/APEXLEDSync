import { useTranslation } from 'react-i18next';
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

interface CloseIssueDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function CloseIssueDialog({ open, onClose, onConfirm }: CloseIssueDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('issues.closePromptTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('issues.closePromptDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {t('issues.keepOpen')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t('issues.closeIssue')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
