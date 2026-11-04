-- What the customer asked for when submitting to the shop (pages, copies, colour,
-- sides, paper), as JSON. NULL when they didn't choose (older jobs, self-print).
ALTER TABLE job_files ADD COLUMN request TEXT;
