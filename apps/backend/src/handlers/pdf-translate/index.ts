import type { SQSEvent, SQSHandler } from 'aws-lambda';
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract';
import { ComprehendClient, DetectDominantLanguageCommand } from '@aws-sdk/client-comprehend';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAMES, docClient } from '@unisync/db-utils';
import type { Language, PdfTranslationJob, Note, NoteAttachment } from '@unisync/shared-types';

const region = process.env.AWS_REGION ?? 'ap-east-1';
// AI services (Textract, Comprehend, Translate) are not available in ap-east-1.
// Use us-east-1 for all AI services while keeping S3/DynamoDB in the local region.
const aiServicesRegion = process.env.AI_SERVICES_REGION ?? 'us-east-1';
const ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET!;

const textractClient = new TextractClient({ region: aiServicesRegion });
const comprehendClient = new ComprehendClient({ region: aiServicesRegion });
const translateClient = new TranslateClient({ region: aiServicesRegion });
const s3Client = new S3Client({ region });

// Map detected language codes to our language codes
function normalizeLanguageCode(awsLangCode: string): Language {
  if (awsLangCode === 'zh' || awsLangCode === 'zh-CN') return 'zh';
  if (awsLangCode === 'zh-TW') return 'zh-TW';
  if (awsLangCode === 'en') return 'en';
  // Default to English for other languages
  return 'en';
}

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
  if (sourceLanguage === targetLanguage) return text;

  const result = await translateClient.send(
    new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: TRANSLATE_CODES[sourceLanguage],
      TargetLanguageCode: TRANSLATE_CODES[targetLanguage],
    })
  );

  return result.TranslatedText ?? text;
}

async function extractTextFromPdf(bucket: string, key: string): Promise<string> {
  // Download PDF from S3
  const getObjectResult = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  const stream = getObjectResult.Body as NodeJS.ReadableStream;
  for await (const chunk of stream) {
    chunks.push(chunk as Uint8Array);
  }
  const pdfBytes = Buffer.concat(chunks);

  // Use Textract to extract text
  const textractResult = await textractClient.send(
    new DetectDocumentTextCommand({
      Document: {
        Bytes: pdfBytes,
      },
    })
  );

  // Extract text from blocks
  const lines: string[] = [];
  for (const block of textractResult.Blocks ?? []) {
    if (block.BlockType === 'LINE' && block.Text) {
      lines.push(block.Text);
    }
  }

  return lines.join('\n');
}

async function detectLanguage(text: string): Promise<Language> {
  if (!text.trim()) return 'en';

  // Take first 5000 characters for detection (Comprehend limit)
  const sampleText = text.substring(0, 5000);

  const result = await comprehendClient.send(
    new DetectDominantLanguageCommand({
      Text: sampleText,
    })
  );

  const topLanguage = result.Languages?.[0];
  if (topLanguage?.LanguageCode) {
    return normalizeLanguageCode(topLanguage.LanguageCode);
  }

  return 'en';
}

// Helper to find a note by ID
async function findNote(showSetId: string, noteId: string): Promise<(Note & { PK: string; SK: string }) | null> {
  const result = await docClient.send(
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
  return (result.Items?.[0] as (Note & { PK: string; SK: string }) | undefined) ?? null;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const job: PdfTranslationJob = JSON.parse(record.body);
    const { noteId, attachmentId, showSetId, s3Key } = job;

    console.log(`Processing PDF translation for attachment ${attachmentId}`, {
      noteId,
      showSetId,
      s3Key,
    });

    try {
      // Find the note
      const note = await findNote(showSetId, noteId);
      if (!note) {
        console.error(`Note ${noteId} not found, skipping`);
        continue;
      }

      // Find the attachment
      const attachmentIndex = note.attachments?.findIndex((a: NoteAttachment) => a.id === attachmentId);
      if (attachmentIndex === undefined || attachmentIndex === -1) {
        console.error(`Attachment ${attachmentId} not found in note ${noteId}, skipping`);
        continue;
      }

      // Extract text from PDF
      let extractedText = '';
      try {
        extractedText = await extractTextFromPdf(ATTACHMENTS_BUCKET, s3Key);
        console.log(`Extracted ${extractedText.length} characters from PDF`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('Failed to extract text from PDF:', err);
        // Update attachment with failed status and actual error details
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAMES.NOTES,
            Key: { PK: note.PK, SK: note.SK },
            UpdateExpression: `SET attachments[${attachmentIndex}].pdfTranslationStatus = :status, attachments[${attachmentIndex}].pdfTranslationError = :error`,
            ExpressionAttributeValues: {
              ':status': 'failed',
              ':error': `Failed to extract text from PDF: ${errorMessage}`,
            },
          })
        );
        continue;
      }

      if (!extractedText.trim()) {
        console.log('No text extracted from PDF');
        await docClient.send(
          new UpdateCommand({
            TableName: TABLE_NAMES.NOTES,
            Key: { PK: note.PK, SK: note.SK },
            UpdateExpression: `SET attachments[${attachmentIndex}].pdfTranslationStatus = :status, attachments[${attachmentIndex}].extractedText = :text`,
            ExpressionAttributeValues: {
              ':status': 'complete',
              ':text': '',
            },
          })
        );
        continue;
      }

      // Detect source language
      const sourceLanguage = await detectLanguage(extractedText);
      console.log(`Detected source language: ${sourceLanguage}`);

      // Translate to all three languages
      const translations: Record<Language, string> = {
        en: '',
        zh: '',
        'zh-TW': '',
      };

      const allLanguages: Language[] = ['en', 'zh', 'zh-TW'];
      for (const targetLang of allLanguages) {
        try {
          translations[targetLang] = await translateText(extractedText, sourceLanguage, targetLang);
          console.log(`Translated to ${targetLang}: ${translations[targetLang].substring(0, 100)}...`);
        } catch (err) {
          console.error(`Failed to translate to ${targetLang}:`, err);
          translations[targetLang] = targetLang === sourceLanguage ? extractedText : '';
        }
      }

      // Update the attachment with extracted text and translations
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAMES.NOTES,
          Key: { PK: note.PK, SK: note.SK },
          UpdateExpression: `SET attachments[${attachmentIndex}].extractedText = :extractedText, attachments[${attachmentIndex}].translatedText = :translatedText, attachments[${attachmentIndex}].pdfTranslationStatus = :status`,
          ExpressionAttributeValues: {
            ':extractedText': extractedText,
            ':translatedText': translations,
            ':status': 'complete',
          },
        })
      );

      console.log(`PDF translation complete for attachment ${attachmentId}`);
    } catch (err) {
      console.error(`Error processing PDF translation for attachment ${attachmentId}:`, err);
      // Let SQS retry or move to DLQ
      throw err;
    }
  }
};
