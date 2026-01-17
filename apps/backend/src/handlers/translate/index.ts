import type { SQSEvent, SQSHandler } from 'aws-lambda';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAMES, docClient } from '@unisync/db-utils';
import type { Language, TranslationJob, Note } from '@unisync/shared-types';

const translateClient = new TranslateClient({
  region: process.env.AWS_REGION ?? 'ap-east-1',
});

// Map our language codes to AWS Translate codes
const TRANSLATE_CODES: Record<Language, string> = {
  en: 'en',
  zh: 'zh',
  'zh-TW': 'zh-TW',
};

async function translateText(
  text: string,
  sourceLanguage: Language,
  targetLanguage: Language
): Promise<string> {
  const result = await translateClient.send(
    new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: TRANSLATE_CODES[sourceLanguage],
      TargetLanguageCode: TRANSLATE_CODES[targetLanguage],
    })
  );

  return result.TranslatedText ?? text;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const job: TranslationJob = JSON.parse(record.body);
    const { noteId, showSetId, originalLang, originalContent, targetLanguages } = job;

    console.log(`Processing translation for note ${noteId}`, {
      originalLang,
      targetLanguages,
    });

    try {
      // Find the note to get its DynamoDB keys
      const notesResult = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAMES.NOTES,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
          FilterExpression: 'noteId = :noteId',
          ExpressionAttributeValues: {
            ':pk': `SHOWSET#${showSetId}`,
            ':skPrefix': 'NOTE#',
            ':noteId': noteId,
          },
        })
      );

      const note = notesResult.Items?.[0] as (Note & { PK: string; SK: string }) | undefined;
      if (!note) {
        console.error(`Note ${noteId} not found, skipping`);
        continue;
      }

      // Translate to each target language
      const translations: Partial<Record<Language, string>> = {};

      for (const targetLang of targetLanguages) {
        try {
          const translated = await translateText(originalContent, originalLang, targetLang);
          translations[targetLang] = translated;
          console.log(`Translated to ${targetLang}:`, translated.substring(0, 100));
        } catch (err) {
          console.error(`Failed to translate to ${targetLang}:`, err);
          translations[targetLang] = ''; // Keep empty on failure
        }
      }

      // Update the note with translations
      const updateExpressions: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, unknown> = {};

      for (const [lang, text] of Object.entries(translations)) {
        // Replace hyphens with underscores for DynamoDB expression placeholders
        const safeLang = lang.replace('-', '_');
        updateExpressions.push(`content.#${safeLang} = :${safeLang}`);
        expressionAttributeNames[`#${safeLang}`] = lang;
        expressionAttributeValues[`:${safeLang}`] = text;
      }

      // Determine translation status
      const allTranslated = Object.values(translations).every((t) => t !== '');
      const translationStatus = allTranslated ? 'complete' : 'failed';

      updateExpressions.push('translationStatus = :status');
      expressionAttributeValues[':status'] = translationStatus;

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAMES.NOTES,
          Key: { PK: note.PK, SK: note.SK },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );

      console.log(`Translation ${translationStatus} for note ${noteId}`);
    } catch (err) {
      console.error(`Error processing translation for note ${noteId}:`, err);
      // Let SQS retry or move to DLQ
      throw err;
    }
  }
};
