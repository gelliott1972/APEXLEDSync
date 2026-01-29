import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Pencil, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { showSetsApi, translateApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ShowSet } from '@unisync/shared-types';

interface EditShowSetDialogProps {
  showSet: ShowSet;
  open: boolean;
  onClose: () => void;
}

const schema = z.object({
  showSetId: z.string().refine(
    (val) => /^SS-\d{2,3}[A-Za-z]*-\d{2}$/.test(val.trim()),
    'Format: SS-XX-XX or SS-XXX-XX (with optional letters like SS-10BC-01)'
  ),
  area: z.enum(['311', '312']),
  scene: z.string().refine(
    (val) => /^SC\d{2}$/.test(val.trim()),
    'Format: SCXX'
  ),
  descriptionEn: z.string().min(1, 'Required'),
  descriptionZh: z.string().min(1, 'Required'),
  descriptionZhTW: z.string().min(1, 'Required'),
  modelUrl: z.string().optional(),
  drawingsUrl: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

type LanguageKey = 'en' | 'zh' | 'zh-TW';

const LANGUAGE_CONFIG: Record<LanguageKey, { labelKey: string; field: keyof FormData }> = {
  en: { labelKey: 'languages.en', field: 'descriptionEn' },
  zh: { labelKey: 'languages.zh', field: 'descriptionZh' },
  'zh-TW': { labelKey: 'languages.zh-TW', field: 'descriptionZhTW' },
};

function normalizeLanguage(lang: string): LanguageKey {
  if (lang === 'zh-TW') return 'zh-TW';
  if (lang.startsWith('zh')) return 'zh';
  return 'en';
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function EditShowSetDialog({ showSet, open, onClose }: EditShowSetDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const currentLang = normalizeLanguage(i18n.language);

  const [isTranslating, setIsTranslating] = useState(false);
  const [overrides, setOverrides] = useState<Record<LanguageKey, boolean>>({
    en: currentLang === 'en',
    zh: currentLang === 'zh',
    'zh-TW': currentLang === 'zh-TW',
  });
  const [versionsExpanded, setVersionsExpanded] = useState(false);
  // 3 deliverable versions: Screen, Revit (structure+integrated), Drawing
  const [screenVersion, setScreenVersion] = useState(showSet.screenVersion ?? 1);
  const [revitVersion, setRevitVersion] = useState(showSet.revitVersion ?? Math.max(showSet.structureVersion ?? 1, showSet.integratedVersion ?? 1));
  const [drawingVersion, setDrawingVersion] = useState(showSet.drawingVersion ?? 1);
  const [versionReason, setVersionReason] = useState('');

  const canEditVersions = user?.role === 'admin' || user?.canEditVersions;

  // Track if versions have changed
  const versionsChanged =
    screenVersion !== (showSet.screenVersion ?? 1) ||
    revitVersion !== (showSet.revitVersion ?? Math.max(showSet.structureVersion ?? 1, showSet.integratedVersion ?? 1)) ||
    drawingVersion !== (showSet.drawingVersion ?? 1);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      showSetId: showSet.showSetId,
      area: showSet.area,
      scene: showSet.scene,
      descriptionEn: showSet.description.en,
      descriptionZh: showSet.description.zh,
      descriptionZhTW: showSet.description['zh-TW'],
      modelUrl: showSet.links.modelUrl || '',
      drawingsUrl: showSet.links.drawingsUrl || '',
    },
  });

  // Reset form and state when dialog opens or showSet changes
  useEffect(() => {
    if (open) {
      reset({
        showSetId: showSet.showSetId,
        area: showSet.area,
        scene: showSet.scene,
        descriptionEn: showSet.description.en,
        descriptionZh: showSet.description.zh,
        descriptionZhTW: showSet.description['zh-TW'],
        modelUrl: showSet.links.modelUrl || '',
        drawingsUrl: showSet.links.drawingsUrl || '',
      });
      // Reset to auto mode for all non-current languages
      setOverrides({
        en: currentLang === 'en',
        zh: currentLang === 'zh',
        'zh-TW': currentLang === 'zh-TW',
      });
      setLastTranslatedText(null);
      // Reset versions (3 deliverables)
      setScreenVersion(showSet.screenVersion ?? 1);
      setRevitVersion(showSet.revitVersion ?? Math.max(showSet.structureVersion ?? 1, showSet.integratedVersion ?? 1));
      setDrawingVersion(showSet.drawingVersion ?? 1);
      setVersionReason('');
    }
  }, [open, showSet, reset, currentLang]);

  // Watch the current language's description for auto-translation
  const currentField = LANGUAGE_CONFIG[currentLang].field;
  const currentDescription = watch(currentField);
  const debouncedDescription = useDebounce(currentDescription, 500);

  // Track original description to detect changes
  const [lastTranslatedText, setLastTranslatedText] = useState<string | null>(null);

  // Auto-translate when user types in their language
  const translateDescription = useCallback(async (text: string, sourceLang: LanguageKey) => {
    if (!text || text.length < 2) return;

    setIsTranslating(true);
    try {
      const result = await translateApi.translate(text, sourceLang);

      // Update other language fields with translations (if not overridden)
      const otherLangs = (['en', 'zh', 'zh-TW'] as LanguageKey[]).filter(l => l !== sourceLang);
      for (const lang of otherLangs) {
        if (!overrides[lang]) {
          const field = LANGUAGE_CONFIG[lang].field;
          setValue(field, result.translations[lang], { shouldValidate: true });
        }
      }
      setLastTranslatedText(text);
    } catch (err) {
      console.error('Translation failed:', err);
    } finally {
      setIsTranslating(false);
    }
  }, [setValue, overrides]);

  // Trigger translation when debounced description changes (and is different from last translated)
  useEffect(() => {
    if (debouncedDescription && debouncedDescription.length >= 2 && debouncedDescription !== lastTranslatedText) {
      translateDescription(debouncedDescription, currentLang);
    }
  }, [debouncedDescription, currentLang, translateDescription, lastTranslatedText]);

  // Reset overrides when language changes
  useEffect(() => {
    setOverrides({
      en: currentLang === 'en',
      zh: currentLang === 'zh',
      'zh-TW': currentLang === 'zh-TW',
    });
  }, [currentLang]);

  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      // Update showset (showSetId, area, scene, description)
      await showSetsApi.update(showSet.showSetId, {
        showSetId: data.showSetId !== showSet.showSetId ? data.showSetId : undefined,
        area: data.area,
        scene: data.scene,
        description: {
          en: data.descriptionEn,
          zh: data.descriptionZh,
          'zh-TW': data.descriptionZhTW,
        },
      });
      // Update links (use new ID if changed)
      const currentId = data.showSetId !== showSet.showSetId ? data.showSetId : showSet.showSetId;
      await showSetsApi.updateLinks(currentId, {
        modelUrl: data.modelUrl || null,
        drawingsUrl: data.drawingsUrl || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      onClose();
    },
    onError: (error) => {
      console.error('Update failed:', error);
      alert(`Update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const versionMutation = useMutation({
    mutationFn: async (data: { screenVersion: number; revitVersion: number; drawingVersion: number; reason: string }) => {
      const updates: Promise<void>[] = [];
      if (data.screenVersion !== (showSet.screenVersion ?? 1)) {
        updates.push(showSetsApi.updateVersion(showSet.showSetId, {
          versionType: 'screenVersion',
          targetVersion: data.screenVersion,
          reason: data.reason,
          language: currentLang,
        }));
      }
      const currentRevitVersion = showSet.revitVersion ?? Math.max(showSet.structureVersion ?? 1, showSet.integratedVersion ?? 1);
      if (data.revitVersion !== currentRevitVersion) {
        updates.push(showSetsApi.updateVersion(showSet.showSetId, {
          versionType: 'revitVersion',
          targetVersion: data.revitVersion,
          reason: data.reason,
          language: currentLang,
        }));
      }
      if (data.drawingVersion !== (showSet.drawingVersion ?? 1)) {
        updates.push(showSetsApi.updateVersion(showSet.showSetId, {
          versionType: 'drawingVersion',
          targetVersion: data.drawingVersion,
          reason: data.reason,
          language: currentLang,
        }));
      }
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      setVersionReason('');
    },
    onError: (error) => {
      console.error('Version update failed:', error);
      alert(`Version update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const onSubmit = async (data: FormData) => {
    // Save form data first
    await updateMutation.mutateAsync(data);
    // Then save version changes if any
    if (versionsChanged) {
      await versionMutation.mutateAsync({ screenVersion, revitVersion, drawingVersion, reason: versionReason });
    }
  };

  const toggleOverride = (lang: LanguageKey) => {
    if (lang !== currentLang) {
      setOverrides(prev => ({ ...prev, [lang]: !prev[lang] }));
    }
  };

  const handleClose = () => {
    reset();
    setLastTranslatedText(null);
    setOverrides({
      en: currentLang === 'en',
      zh: currentLang === 'zh',
      'zh-TW': currentLang === 'zh-TW',
    });
    onClose();
  };

  if (!open) return null;

  const renderDescriptionField = (lang: LanguageKey) => {
    const config = LANGUAGE_CONFIG[lang];
    const isCurrentLang = lang === currentLang;
    const isOverridden = overrides[lang];
    const isEditable = isCurrentLang || isOverridden;

    return (
      <div key={lang} className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={config.field} className={cn('text-xs', !isEditable && 'text-muted-foreground')}>
            {t(config.labelKey)}
            {isCurrentLang && <span className="ml-1 text-primary">*</span>}
          </Label>
          {!isCurrentLang && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                toggleOverride(lang);
              }}
            >
              {isOverridden ? (
                <><Check className="mr-1 h-3 w-3" />Auto</>
              ) : (
                <><Pencil className="mr-1 h-3 w-3" />Edit</>
              )}
            </Button>
          )}
        </div>
        <div className="relative">
          {isCurrentLang ? (
            <Input
              id={config.field}
              {...register(config.field as any)}
              className="h-8 text-sm"
            />
          ) : (
            <Input
              id={config.field}
              {...register(config.field as any)}
              disabled={!isEditable}
              className={cn('h-8 text-sm', !isEditable && 'bg-muted text-muted-foreground')}
            />
          )}
          {!isCurrentLang && isTranslating && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-md">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        {errors[config.field as keyof FormData] && (
          <p className="text-xs text-destructive">{(errors[config.field as keyof FormData] as any)?.message}</p>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-base font-semibold">{t('showset.details')}</h2>
          {isTranslating && (
            <span className="flex items-center text-xs text-muted-foreground">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              {t('notes.translating')}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Top row: ID (readonly), Area, Scene */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
            <div>
              <Label htmlFor="showSetId" className="text-xs">{t('showset.id')}</Label>
              <Input
                id="showSetId"
                placeholder="SS-07-01"
                className="h-8 text-sm"
                {...register('showSetId')}
              />
            </div>
            <div>
              <Label className="text-xs">{t('showset.area')}</Label>
              <Select
                value={watch('area')}
                onValueChange={(value) => setValue('area', value as '311' | '312')}
              >
                <SelectTrigger className="h-8 w-24 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="311">311</SelectItem>
                  <SelectItem value="312">312</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="scene" className="text-xs">{t('showset.scene')}</Label>
              <Input id="scene" placeholder="SC07" className="h-8 w-20 text-sm" {...register('scene')} />
            </div>
          </div>
          {(errors.showSetId || errors.scene) && (
            <p className="text-xs text-destructive">
              {errors.showSetId?.message || errors.scene?.message}
            </p>
          )}

          {/* Descriptions */}
          <div className="space-y-2 pt-1">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('showset.description')}</h3>
            {renderDescriptionField(currentLang)}
            {(['en', 'zh', 'zh-TW'] as LanguageKey[])
              .filter(lang => lang !== currentLang)
              .map(lang => renderDescriptionField(lang))}
          </div>

          {/* Links */}
          <div className="space-y-2 pt-1">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('showset.links')}</h3>
            <div>
              <Label htmlFor="modelUrl" className="text-xs">{t('showset.modelUrl')}</Label>
              <Input
                id="modelUrl"
                placeholder="https://..."
                className="h-8 text-sm"
                {...register('modelUrl')}
              />
            </div>
            <div>
              <Label htmlFor="drawingsUrl" className="text-xs">{t('showset.drawingsUrl')}</Label>
              <Input
                id="drawingsUrl"
                placeholder="https://..."
                className="h-8 text-sm"
                {...register('drawingsUrl')}
              />
            </div>
          </div>

          {/* Versions - only visible if user can edit versions */}
          {canEditVersions && (
            <div className="space-y-2 pt-1">
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                onClick={() => setVersionsExpanded(!versionsExpanded)}
              >
                {versionsExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {t('showset.versions')}
              </button>
              {versionsExpanded && (
                <div className="space-y-2 pl-4 border-l-2 border-muted">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor="screenVersion" className="text-xs">{t('stages.short.screen')}</Label>
                      <Input
                        id="screenVersion"
                        type="number"
                        min={1}
                        value={screenVersion}
                        onChange={(e) => setScreenVersion(Math.max(1, parseInt(e.target.value) || 1))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="revitVersion" className="text-xs">Revit</Label>
                      <Input
                        id="revitVersion"
                        type="number"
                        min={1}
                        value={revitVersion}
                        onChange={(e) => setRevitVersion(Math.max(1, parseInt(e.target.value) || 1))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="drawingVersion" className="text-xs">{t('stages.short.drawing2d')}</Label>
                      <Input
                        id="drawingVersion"
                        type="number"
                        min={1}
                        value={drawingVersion}
                        onChange={(e) => setDrawingVersion(Math.max(1, parseInt(e.target.value) || 1))}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  {versionsChanged && (
                    <div>
                      <Label htmlFor="versionReason" className="text-xs">{t('showset.versionReason')} ({t('common.optional')})</Label>
                      <Input
                        id="versionReason"
                        value={versionReason}
                        onChange={(e) => setVersionReason(e.target.value)}
                        placeholder={t('showset.versionReasonPlaceholder')}
                        className="h-8 text-sm"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </form>
        <div className="flex justify-end gap-2 p-4 border-t bg-background">
          <Button type="button" variant="outline" size="sm" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={updateMutation.isPending || versionMutation.isPending || isTranslating}
            onClick={handleSubmit(onSubmit)}
          >
            {(updateMutation.isPending || versionMutation.isPending) ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('common.loading')}</>
            ) : (
              t('common.save')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
