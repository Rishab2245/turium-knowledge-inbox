import { z } from 'zod';
import { config } from '../config/index.js';

/**
 * Request validation lives next to the routes and is the only place untrusted
 * input is trusted from. Every handler parses its input before touching the
 * service layer, so services can assume well-formed arguments.
 */

const noteSchema = z.object({
  type: z.literal('note'),
  content: z
    .string()
    .trim()
    .min(1, 'content must not be empty')
    .max(config.MAX_NOTE_CHARS, `content must be at most ${config.MAX_NOTE_CHARS} characters`),
  title: z.string().trim().max(300).optional(),
});

const urlSchema = z.object({
  type: z.literal('url'),
  url: z
    .string()
    .trim()
    .url('url must be a valid absolute URL')
    .refine((value) => /^https?:/i.test(value), 'url must use http or https'),
  title: z.string().trim().max(300).optional(),
});

/**
 * A discriminated union on `type` rather than "content or url, whichever is
 * present". It makes the contract explicit in both directions and gives the
 * caller a precise error instead of a guess about which shape they meant.
 */
export const ingestRequestSchema = z.discriminatedUnion('type', [noteSchema, urlSchema]);
export type IngestRequest = z.infer<typeof ingestRequestSchema>;

export const listItemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'processing', 'ready', 'failed']).optional(),
  cursor: z.string().min(1).optional(),
});

export const queryRequestSchema = z.object({
  question: z.string().trim().min(3, 'question must be at least 3 characters').max(2000),
  topK: z.coerce.number().int().min(1).max(20).optional(),
  /** Optional scope: ask against a subset of saved items. */
  itemIds: z.array(z.string().uuid()).max(50).optional(),
});

export const itemIdParamSchema = z.object({
  id: z.string().uuid('item id must be a UUID'),
});
