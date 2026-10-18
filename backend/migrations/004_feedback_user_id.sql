-- Migration 004: add user_id column to feedbacks table
ALTER TABLE feedbacks ADD COLUMN user_id INT NULL AFTER id;
