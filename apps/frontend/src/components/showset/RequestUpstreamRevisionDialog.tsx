import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Upload, X } from 'lucide-react';
import type { ShowSet, StageName } from '@unisync/shared-types';
import { showSetsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface RequestUpstreamRevisionDialogProps {
  showSet: ShowSet;
  currentStage: StageName;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const STAGE_ORDER: StageName[] = ['screen', 'structure', 'inBim360', 'drawing2d'];

export function RequestUpstreamRevisionDialog({
  showSet,
  currentStage,
  open,
  onClose,
  onSuccess,
}: RequestUpstreamRevisionDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [selectedTarget, setSelectedTarget] = useState<StageName | null>(null);
  const [revisionNote, setRevisionNote] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);

  // Get upstream stages (stages before current)
  const currentIdx = STAGE_ORDER.indexOf(currentStage);
  const upstreamStages = STAGE_ORDER.slice(0, currentIdx);

  // Calculate affected stages when target is selected
  const getAffectedStages = (): StageName[] => {
    if (!selectedTarget) return [];

    const targetIdx = STAGE_ORDER.indexOf(selectedTarget);
    const affected: StageName[] = [];

    // All stages from target through current (inclusive)
    for (let i = targetIdx; i <= currentIdx; i++) {
      affected.push(STAGE_ORDER[i]);
    }

    return affected;
  };

  const affectedStages = getAffectedStages();

  // Mutation for requesting upstream revision
  const requestRevisionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTarget || !revisionNote.trim()) {
        throw new Error('Target and revision note are required');
      }

      const lang = i18n.language as 'en' | 'zh' | 'zh-TW';

      // Call the request-revision endpoint
      const response = await showSetsApi.requestUpstreamRevision(showSet.showSetId, {
        targetStages: [selectedTarget],
        currentStage,
        revisionNote: revisionNote.trim(),
        revisionNoteLang: lang,
        attachment: attachment ? {
          fileName: attachment.name,
          mimeType: attachment.type,
          fileSize: attachment.size,
        } : undefined,
      });

      // If there's an attachment and we got an upload URL, upload the file
      if (attachment && response.uploadUrl) {
        await fetch(response.uploadUrl, {
          method: 'PUT',
          body: attachment,
          headers: {
            'Content-Type': attachment.type,
          },
        });
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      queryClient.invalidateQueries({ queryKey: ['issues', showSet.showSetId] });
      onSuccess?.();
      handleClose();
    },
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedTarget(null);
      setRevisionNote('');
      setAttachment(null);
    }
  }, [open]);

  const handleClose = () => {
    setSelectedTarget(null);
    setRevisionNote('');
    setAttachment(null);
    onClose();
  };

  const handleSubmit = () => {
    requestRevisionMutation.mutate();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        alert(t('revision.invalidFileType', 'Only PDF and image files are allowed'));
        return;
      }
      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        alert(t('revision.fileTooLarge', 'File size must be less than 10MB'));
        return;
      }
      setAttachment(file);
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('revision.requestUpstream', 'Request Upstream Revision')}</DialogTitle>
          <DialogDescription>
            {t('revision.upstreamDescription', 'Select which upstream stage needs revision. All stages between the selected stage and your current stage will be marked for revision.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Stage Info */}
          <div className="text-sm text-muted-foreground">
            {t('revision.currentStage', 'Current stage')}: <span className="font-medium text-foreground">{t(`stages.${currentStage}`)}</span>
          </div>

          {/* Target Stage Selection */}
          {upstreamStages.length > 0 ? (
            <>
              <div className="space-y-3">
                <Label>{t('revision.selectTarget', 'Select stage that needs revision')}</Label>
                <RadioGroup value={selectedTarget ?? ''} onValueChange={(value) => setSelectedTarget(value as StageName)}>
                  {upstreamStages.map((stage) => (
                    <div key={stage} className="flex items-center space-x-2">
                      <RadioGroupItem value={stage} id={`target-${stage}`} />
                      <Label htmlFor={`target-${stage}`} className="font-normal cursor-pointer">
                        {t(`stages.${stage}`)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {/* Affected Stages Warning */}
              {affectedStages.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>{t('revision.affectedStages', 'Affected stages')}:</strong>
                    {' '}
                    {affectedStages.map((stage) => t(`stages.${stage}`)).join(', ')}
                    <div className="text-xs mt-1 opacity-75">
                      {t('revision.affectedDescription', 'All these stages will be set to "Revision Required"')}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* Revision Note */}
              <div className="space-y-2">
                <Label htmlFor="revision-note">
                  {t('revision.note', 'Revision Note')} <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="revision-note"
                  placeholder={t('revision.notePlaceholder', 'Describe what needs to be revised and why...')}
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
              </div>

              {/* File Attachment */}
              <div className="space-y-2">
                <Label htmlFor="attachment">{t('revision.attachment', 'Attachment')} {t('common.optional', '(Optional)')}</Label>
                {attachment ? (
                  <div className="flex items-center gap-2 p-2 border rounded-md">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm flex-1">{attachment.name}</span>
                    <Button variant="ghost" size="sm" onClick={removeAttachment}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      id="attachment"
                      type="file"
                      accept=".pdf,image/png,image/jpeg,image/gif,image/webp"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('attachment')?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {t('revision.chooseFile', 'Choose File')}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {t('revision.fileTypes', 'PDF or images, max 10MB')}
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Alert>
              <AlertDescription>
                {t('revision.noUpstreamStages', 'There are no upstream stages to request revision from.')}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={requestRevisionMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedTarget || !revisionNote.trim() || requestRevisionMutation.isPending || upstreamStages.length === 0}
          >
            {requestRevisionMutation.isPending ? t('common.loading') : t('revision.submit', 'Submit Request')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
