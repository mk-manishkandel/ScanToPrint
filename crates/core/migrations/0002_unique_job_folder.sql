-- Two customers starting a job at the same instant must never get the same code/folder.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_storage_dir_uq ON jobs(storage_dir);
