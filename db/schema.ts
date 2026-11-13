import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const registrationFeedback = pgTable('registration_feedback', {
  id: text('id').primaryKey(),
  feedback: text('feedback').notNull().default(''),
  attendanceConfirmed: boolean('attendance_confirmed').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
