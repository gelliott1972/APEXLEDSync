import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Pencil, Check } from 'lucide-react';
import { showSetsApi, translateApi } from '@/lib/api';
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
import type { Area } from '@unisync/shared-types';

interface CreateShowSetDialogProps {
  open: boolean;
  onClose: () => void;
}

const schema = z.object({
  showSetId: z.string().refine(
    (val) => /^SS-\d{2}[A-Za-z]?-\d{2}$/.test(val.trim()),
    'Format: SS-XX-XX or SS-XXY-XX'
  ),
  area: z.enum(['311', '312']),
  scene: z.string().refine(
    (val) => /^SC\d{2}$/.test(val.trim()),
    'Format: SCXX'
  ),
  descriptionEn: z.string().min(1, 'Required'),
  descriptionZh: z.string().min(1, 'Required'),
  descriptionZhTW: z.string().min(1, 'Required'),
});

type FormData = z.infer<typeof schema>;

type LanguageKey = 'en' | 'zh' | 'zh-TW';

const LANGUAGE_CONFIG: Record<LanguageKey, { labelKey: string; field: keyof FormData }> = {
  en: { labelKey: 'languages.en', field: 'descriptionEn' },
  zh: { labelKey: 'languages.zh', field: 'descriptionZh' },
  'zh-TW': { labelKey: 'languages.zh-TW', field: 'descriptionZhTW' },
};

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

function normalizeLanguage(lang: string): LanguageKey {
  if (lang === 'zh-TW') return 'zh-TW';
  if (lang.startsWith('zh')) return 'zh';
  return 'en';
}

export function CreateShowSetDialog({ open, onClose }: CreateShowSetDialogProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentLang = normalizeLanguage(i18n.language);

  const [isTranslating, setIsTranslating] = useState(false);
  const [overrides, setOverrides] = useState<Record<LanguageKey, boolean>>({
    en: currentLang === 'en',
    zh: currentLang === 'zh',
    'zh-TW': currentLang === 'zh-TW',
  });

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
      area: '311',
      descriptionEn: '',
      descriptionZh: '',
      descriptionZhTW: '',
    },
  });

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      reset({
        area: '311',
        descriptionEn: '',
        descriptionZh: '',
        descriptionZhTW: '',
      });
      // Reset to auto mode for all non-current languages
      setOverrides({
        en: currentLang === 'en',
        zh: currentLang === 'zh',
        'zh-TW': currentLang === 'zh-TW',
      });
    }
  }, [open, reset, currentLang]);

  // Watch the current language's description for auto-translation
  const currentField = LANGUAGE_CONFIG[currentLang].field;
  const currentDescription = watch(currentField);
  const debouncedDescription = useDebounce(currentDescription, 500);

  // Watch ShowSet ID to auto-populate scene
  const showSetId = watch('showSetId');
  useEffect(() => {
    if (showSetId) {
      // Extract scene from SS-XX-YY format (XX is the scene number)
      const match = showSetId.match(/^SS-(\d{2})/);
      if (match) {
        setValue('scene', `SC${match[1]}`, { shouldValidate: false });
      }
    }
  }, [showSetId, setValue]);

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
    } catch (err) {
      console.error('Translation failed:', err);
    } finally {
      setIsTranslating(false);
    }
  }, [setValue, overrides]);

  // Trigger translation when debounced description changes
  useEffect(() => {
    if (debouncedDescription && debouncedDescription.length >= 2) {
      translateDescription(debouncedDescription, currentLang);
    }
  }, [debouncedDescription, currentLang, translateDescription]);

  // Reset overrides when language changes
  useEffect(() => {
    setOverrides({
      en: currentLang === 'en',
      zh: currentLang === 'zh',
      'zh-TW': currentLang === 'zh-TW',
    });
  }, [currentLang]);

  const createMutation = useMutation({
    mutationFn: showSetsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['showsets'] });
      reset();
      onClose();
    },
    onError: (error) => {
      console.error('Create failed:', error);
      alert(`Create failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });

  const onSubmit = (data: FormData) => {
    createMutation.mutate({
      showSetId: data.showSetId,
      area: data.area as Area,
      scene: data.scene,
      description: {
        en: data.descriptionEn,
        zh: data.descriptionZh,
        'zh-TW': data.descriptionZhTW,
      },
    });
  };

  const toggleOverride = (lang: LanguageKey) => {
    if (lang !== currentLang) {
      setOverrides(prev => ({ ...prev, [lang]: !prev[lang] }));
    }
  };

  const handleClose = () => {
    reset();
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
    const fieldValue = watch(config.field);

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
              {...register(config.field)}
              className="h-8 text-sm"
            />
          ) : (
            <Input
              id={config.field}
              {...register(config.field)}
              disabled={!isEditable}
              className={cn('h-8 text-sm', !isEditable && 'bg-muted text-muted-foreground')}
            />
          )}
          {!isCurrentLang && isTranslating && !fieldValue && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-md">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        {errors[config.field] && (
          <p className="text-xs text-destructive">{errors[config.field]?.message}</p>
        )}
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        className="bg-background rounded-lg shadow-lg w-full max-w-md max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-base font-semibold">{t('showset.createNew')}</h2>
          {isTranslating && (
            <span className="flex items-center text-xs text-muted-foreground">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Translating...
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-4 space-y-3">
          {/* Top row: ID, Area, Scene */}
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
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('showset.descriptions')}</h3>
            {renderDescriptionField(currentLang)}
            {(['en', 'zh', 'zh-TW'] as LanguageKey[])
              .filter(lang => lang !== currentLang)
              .map(lang => renderDescriptionField(lang))}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" size="sm" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={createMutation.isPending || isTranslating}>
              {createMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('common.loading')}</>
              ) : (
                t('common.create')
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
