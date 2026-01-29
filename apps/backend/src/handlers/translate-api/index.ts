import type { APIGatewayProxyHandler } from 'aws-lambda';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { success, unauthorized, validationError, internalError } from '../../lib/response.js';
import { getAuthContext } from '../../lib/auth.js';
import type { Language } from '@unisync/shared-types';

const translateClient = new TranslateClient({
  region: process.env.AWS_REGION ?? 'ap-east-1',
});

// Map our language codes to AWS Translate codes
const TRANSLATE_CODES: Record<Language, string> = {
  en: 'en',
  zh: 'zh',
  'zh-TW': 'zh-TW',
};

const ALL_LANGUAGES: Language[] = ['en', 'zh', 'zh-TW'];

interface TranslateRequest {
  text: string;
  sourceLanguage: Language;
  targetLanguages?: Language[];
}

interface TranslateResponse {
  translations: Record<Language, string>;
}

async function translateText(
  text: string,
  sourceLanguage: Language,
  targetLanguage: Language
): Promise<string> {
  if (sourceLanguage === targetLanguage) {
    return text;
  }

  const result = await translateClient.send(
    new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: TRANSLATE_CODES[sourceLanguage],
      TargetLanguageCode: TRANSLATE_CODES[targetLanguage],
    })
  );

  return result.TranslatedText ?? text;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  // Require authentication
  const user = getAuthContext(event);
  if (!user) {
    return unauthorized();
  }

  if (event.httpMethod !== 'POST') {
    return validationError('Method not allowed');
  }

  try {
    const body: TranslateRequest = JSON.parse(event.body ?? '{}');
    const { text, sourceLanguage, targetLanguages } = body;

    if (!text || !sourceLanguage) {
      return validationError('Missing required fields: text, sourceLanguage');
    }

    if (!ALL_LANGUAGES.includes(sourceLanguage)) {
      return validationError('Invalid sourceLanguage');
    }

    // Default to translating to all other languages
    const targets = targetLanguages ?? ALL_LANGUAGES.filter((l) => l !== sourceLanguage);

    // Translate to each target language in parallel
    const translationPromises = targets.map(async (targetLang) => {
      try {
        const translated = await translateText(text, sourceLanguage, targetLang);
        return [targetLang, translated] as const;
      } catch (err) {
        console.error(`Translation to ${targetLang} failed:`, err);
        return [targetLang, ''] as const;
      }
    });

    const results = await Promise.all(translationPromises);

    // Build response with original text included
    const translations: Record<Language, string> = {
      en: '',
      zh: '',
      'zh-TW': '',
    };

    translations[sourceLanguage] = text;

    for (const [lang, translated] of results) {
      translations[lang] = translated;
    }

    return success<TranslateResponse>({ translations });
  } catch (err) {
    console.error('Translation error:', err);
    return internalError('Translation failed');
  }
};
