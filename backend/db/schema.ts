import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const cinemaReplies = sqliteTable('cinema_replies', {
  requestId: text('request_id').primaryKey(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  telegramMessageId: integer('telegram_message_id'),
});
