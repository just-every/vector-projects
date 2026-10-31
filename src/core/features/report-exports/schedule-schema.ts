import { z } from 'zod';
import { IntegrationError } from '../integrations/errors';

export const scheduleId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const atom = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/);
export const bucketConfiguration = z.object({
  endpoint: z.string().url().max(200),
  region: z.string().regex(/^[a-z0-9-]{2,30}$/),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  prefix: atom.default('vector'),
  format: z.enum(['json','csv']).default('json'),
  team: scheduleId.optional(),
}).strict();
export const bucketCredentials = z.object({
  accessKeyId: z.string().min(10).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  secretAccessKey: z.string().min(20).max(256),
}).strict();
export const createBucketSchedule = z.object({
  name: z.string().trim().min(1).max(120), kind: z.literal('bucket'),
  configuration: bucketConfiguration, credentials: bucketCredentials,
  consent: z.literal(true), enabled: z.boolean().default(false),
}).strict();
export const sheetsConfiguration = z.object({
  viewId: scheduleId,
  spreadsheetId: z.string().regex(/^[a-zA-Z0-9_-]{10,128}$/),
  sheet: z.string().trim().min(1).max(100).refine(value=>!/[\r\n\x00]/.test(value)),
}).strict();
export const sheetsCredentials = z.object({
  clientId:z.string().min(10).max(256),clientSecret:z.string().min(10).max(256),refreshToken:z.string().min(10).max(1024),
}).strict();
export const createSheetsSchedule = z.object({
  name:z.string().trim().min(1).max(120),kind:z.literal('sheets'),
  configuration:sheetsConfiguration,credentials:sheetsCredentials,
  consent:z.literal(true),enabled:z.boolean().default(false),
}).strict();
export const createSchedule = z.discriminatedUnion('kind',[createBucketSchedule,createSheetsSchedule]);
export const changeSchedule = z.object({expectedVersion:z.number().int().positive(),enabled:z.boolean(),consent:z.literal(true)}).strict();

/** Credentials can go only to the named provider API, with no redirects. The
 * first implementation supports AWS S3 and R2, not arbitrary signed endpoints. */
export function bucketEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' ||
      !(/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) || /^s3\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)))
    throw new IntegrationError(400,'export_destination_refused');
  return url.origin;
}
